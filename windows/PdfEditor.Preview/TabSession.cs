using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using Microsoft.Web.WebView2.Core;
using DaydayPDF.Printing;

namespace PdfEditor.Preview;

public sealed class TabSession : INotifyPropertyChanged
{
    private string _title;
    private string? _docPath;
    private bool _isDirty;
    private bool _hasHistory;
    private bool _isActive;
    private bool _isSelected;

    public TabSession(string title, string? docPath, Guid? id = null)
    {
        Id = id is { } restored && restored != Guid.Empty ? restored : Guid.NewGuid();
        _title = title;
        DocPath = docPath;
        Touch();
    }

    public Guid Id { get; }
    public CoreWebView2Controller? Controller { get; internal set; }
    public CoreWebView2? WebView => Controller?.CoreWebView2;
    public MainWindow? Owner { get; internal set; }
    public string? DocPath
    {
        get => _docPath;
        internal set
        {
            if (string.Equals(_docPath, value, StringComparison.OrdinalIgnoreCase)) return;
            _docPath = value;
            if (PrintInbox.Contains(value)) TemporaryPrintPath = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(TabToolTip));
            OnPropertyChanged(nameof(IsDirty));
        }
    }
    public string? PendingOpenPath { get; internal set; }
    public string? TemporaryPrintPath { get; private set; }
    public bool IsTemporaryPrint => TemporaryPrintPath is not null;
    public bool ViewReady { get; internal set; }
    public bool DocumentSent { get; internal set; }
    internal int SaveTargetRevision { get; set; }
    public bool HasDocument { get; internal set; }
    public bool IsUnloaded { get; internal set; }
    internal Task? ReloadTask { get; set; }
    public bool PasteClipboardOnReady { get; internal set; }
    public bool RestoreFromAutosave { get; internal set; }
    public bool RestoreFallbackTried { get; internal set; }
    public string? PendingClipboardTitle { get; internal set; }
    public long LastViewedTimestamp { get; internal set; }
    public long LastUsedTimestamp { get; private set; }
    public bool CanClose => true;

    public string TabToolTip
    {
        get
        {
            if (IsTemporaryPrint)
                return $"{Title}.pdf\n\n미저장 인쇄 문서\n저장하지 않고 탭을 닫으면 임시 파일이 삭제됩니다.";
            string fileName = string.IsNullOrWhiteSpace(DocPath)
                ? (Title.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? Title : Title + ".pdf")
                : Path.GetFileName(DocPath);
            string filePath = string.IsNullOrWhiteSpace(DocPath)
                ? "저장 위치가 아직 없습니다."
                : DocPath;
            return $"파일명\n{fileName}\n\n경로\n{filePath}";
        }
    }

    public string Title
    {
        get => _title;
        internal set
        {
            string next = string.IsNullOrWhiteSpace(value) ? "새 문서" : value.Trim();
            if (_title == next) return;
            _title = next;
            OnPropertyChanged();
            OnPropertyChanged(nameof(TabToolTip));
        }
    }

    public bool IsDirty
    {
        get => _isDirty || IsTemporaryPrint;
        internal set
        {
            if (_isDirty == value) return;
            _isDirty = value;
            OnPropertyChanged();
        }
    }

    public bool HasHistory
    {
        get => _hasHistory;
        internal set
        {
            if (_hasHistory == value) return;
            _hasHistory = value;
            OnPropertyChanged();
        }
    }

    public bool IsActive
    {
        get => _isActive;
        internal set
        {
            if (_isActive == value) return;
            _isActive = value;
            OnPropertyChanged();
        }
    }

    public bool IsSelected
    {
        get => _isSelected;
        internal set
        {
            if (_isSelected == value) return;
            _isSelected = value;
            OnPropertyChanged();
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public void Touch() => LastUsedTimestamp = Stopwatch.GetTimestamp();

    internal void ReleaseTemporaryPrint()
    {
        string? path = TemporaryPrintPath;
        TemporaryPrintPath = null;
        if (path is not null && !TabRegistry.All.Values.Any(tab =>
            tab != this && string.Equals(tab.TemporaryPrintPath, path, StringComparison.OrdinalIgnoreCase)))
            PrintInbox.TryDelete(path);
        OnPropertyChanged(nameof(IsDirty));
        OnPropertyChanged(nameof(TabToolTip));
    }

    internal void CloseController()
    {
        CoreWebView2Controller? controller = Controller;
        Controller = null;
        ViewReady = false;
        DocumentSent = false;
        IsUnloaded = true;
        if (controller is null) return;
        try { controller.IsVisible = false; } catch { }
        try { controller.Close(); } catch { }
    }

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}

internal static class TabRegistry
{
    public static Dictionary<Guid, TabSession> All { get; } = new();
    public static Dictionary<IntPtr, List<Guid>> ByWindow { get; } = new();

    public static void Register(TabSession session, MainWindow owner)
    {
        All.Add(session.Id, session);
        AssignOwner(session, owner);
    }

    public static void AssignOwner(TabSession session, MainWindow owner, int index = -1)
    {
        if (session.Owner is { } previous && previous.Handle != IntPtr.Zero &&
            ByWindow.TryGetValue(previous.Handle, out List<Guid>? previousTabs))
        {
            previousTabs.Remove(session.Id);
        }

        session.Owner = owner;
        if (!ByWindow.TryGetValue(owner.Handle, out List<Guid>? nextTabs))
        {
            nextTabs = new List<Guid>();
            ByWindow[owner.Handle] = nextTabs;
        }

        nextTabs.Remove(session.Id);
        if (index < 0 || index > nextTabs.Count) nextTabs.Add(session.Id);
        else nextTabs.Insert(index, session.Id);
    }

    public static void RegisterWindow(IntPtr handle)
    {
        if (handle != IntPtr.Zero) ByWindow.TryAdd(handle, new List<Guid>());
    }

    public static void UnregisterWindow(IntPtr handle)
    {
        if (handle != IntPtr.Zero) ByWindow.Remove(handle);
    }

    public static void Close(TabSession session, bool deleteTemporaryPrint = true)
    {
        if (session.Owner is { } owner && owner.Handle != IntPtr.Zero &&
            ByWindow.TryGetValue(owner.Handle, out List<Guid>? tabs))
        {
            tabs.Remove(session.Id);
        }
        All.Remove(session.Id);
        session.Owner = null;
        session.CloseController();
        if (deleteTemporaryPrint) session.ReleaseTemporaryPrint();
    }
}
