using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using DrawingRectangle = System.Drawing.Rectangle;

namespace PdfEditor.Preview;

public partial class MainWindow : Window
{
    private const string LocalAppHost = "app.pdfeditor.local";
    private const string LocalViewUrl = "https://app.pdfeditor.local/view.html";
    private const int HostApiVersion = 4;
    private const double MinimumNativeTabWidth = 128;
    private const double NativeTabsLeadingInset = 36;
    private const double NativeTabsTrailingInset = 12;
    private const double NativeCaptionHeight = 34;
    private const double TopResizeStripHeight = 3;
    private const long MaximumSharedFileSize = 2L * 1024 * 1024 * 1024 - 1;
    private const string NativeTabDragFormat = "PdfEditor.Preview.DirectTab.v2";
    private const int DwmUseImmersiveDarkMode = 20;
    private const int DwmUseImmersiveDarkModeBefore20H1 = 19;
    private const int DwmWindowCornerPreference = 33;
    private const int DwmWindowCornerPreferenceRound = 2;
    private const int WmGetMinMaxInfo = 0x0024;
    private const int WmMove = 0x0003;
    private const int WmSize = 0x0005;
    private const int WmDpiChanged = 0x02E0;
    private const int WmExitSizeMove = 0x0232;
    private const int WmMoving = 0x0216;
    private const int WmCancelMode = 0x001F;
    private const int WmNcLButtonDown = 0x00A1;
    private const int HtCaption = 2;
    private const int HtLeft = 10;
    private const int HtRight = 11;
    private const int HtTop = 12;
    private const int HtTopLeft = 13;
    private const int HtTopRight = 14;
    private const int HtBottom = 15;
    private const int HtBottomLeft = 16;
    private const int HtBottomRight = 17;
    private const int SwHide = 0;
    private const int SwShow = 5;
    private const uint WsPopup = 0x80000000;
    private const uint WsChild = 0x40000000;
    private const uint WsClipSiblings = 0x04000000;
    private const uint WsClipChildren = 0x02000000;
    private const uint WsExToolWindow = 0x00000080;
    private const uint WsExNoActivate = 0x08000000;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;
    private const uint MonitorDefaultToNearest = 0x00000002;
    private static readonly JsonSerializerOptions WebJsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Dictionary<IntPtr, MainWindow> OpenWindows = new();
    private static MainWindow? _lastActiveWindow;
    private static IntPtr _controllerParkingHostHandle;
    private const int RecentInactiveControllerCount = 5;
    private const int ControllerTrimThreshold = 12;
    private static readonly TimeSpan IdleUnloadAfter = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan IdleFlushTimeout = TimeSpan.FromMinutes(2);
    private static readonly string PreviewVersion =
        typeof(MainWindow).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion ?? "DEV";
    private static readonly string ProductTitle = $"PDF 편집기 Preview — BETA {PreviewVersion}";
#if PDF_EDITOR_PREVIEW
    private const bool PreviewAccessBypass = true;
#else
    private const bool PreviewAccessBypass = false;
#endif

    private readonly Queue<LaunchRequest> _pendingRequests = new();
    private bool _drainingLaunchRequests;
    private bool _restoringDesktopTabs;
    private readonly Dictionary<string, TaskCompletionSource<string>> _pendingCloseConfirmations = new();
    private readonly Dictionary<string, (TabSession Session, TaskCompletionSource<bool> Completion)> _pendingCloseSaves = new();
    private readonly HashSet<Guid> _closingTabs = new();
    private readonly HashSet<Guid> _discardedCloseTabs = new();
    private readonly Dictionary<string, TaskCompletionSource<string?>> _pendingMultiOpenChoices = new();
    private readonly Dictionary<string, TaskCompletionSource<bool>> _pendingFlushes = new();
    private static readonly Dictionary<string, OutboundBuffer> OutboundBuffers = new();
    private static readonly Dictionary<string, PendingWrite> PendingWrites = new();
    private static readonly Dictionary<Guid, (string RequestId, long StartedTimestamp)> PendingIdleFlush = new();
    private readonly bool _createInitialTab;
    private readonly IReadOnlyList<DesktopRecoveryTab> _recoveryTabs;
    private readonly OnlineLeaseSession _onlineLease = new(PreviewAccessBypass, TimeSpan.FromMinutes(5));
    private readonly DispatcherTimer _onlineLeaseTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly DispatcherTimer _idleTimer = new() { Interval = TimeSpan.FromSeconds(15) };
    private readonly DispatcherTimer _startupProgressTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer _startupReadyTimeoutTimer = new() { Interval = TimeSpan.FromSeconds(60) };
    private readonly DispatcherTimer _contentProgressTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private CoreWebView2Environment? _environment;
    private HwndSource? _hwndSource;
    private IntPtr _contentHostHandle;
    private TabSession? _activeSession;
    private IReadOnlyList<TabSession>? _tearOffDockCandidates;
    private TabSession? _tearOffDockPrimary;
    private Point _nativeTabDragStart;
    private TabSession? _nativeTabDragSession;
    private IReadOnlyList<TabSession>? _nativeTabDragGroup;
    private TabSession? _nativeTabSelectionAnchor;
    private readonly HashSet<FrameworkElement> _nativeTabDragVisuals = new();
    private double _nativeTabGrabOffsetX;
    private bool _nativeTabDragStarted;
    private bool _initialized;
    private bool _closing;
    private bool _windowCloseConfirmationPending;
    private bool _windowCloseAuthorized;
    private bool _nativeTabWidthUpdateQueued;
    private bool _controllerHostUpdateQueued;
    private bool _controllerBoundsUpdatePending;
    private bool _liveDockQueued;
    private bool _startupOverlayDismissed;
    private string _editorTheme = "dark";

    public ObservableCollection<TabSession> NativeTabs { get; } = new();
    internal IntPtr Handle { get; private set; }

    internal static MainWindow? GetPreferredLaunchWindow(LaunchRequest? request = null)
    {
        if (request is { Action: "open", Files.Length: 1 } && FindOpenSession(request.Files[0])?.Owner is { } owner)
            return owner;
        return _lastActiveWindow ?? OpenWindows.Values.FirstOrDefault();
    }

    public MainWindow() : this(createInitialTab: true, Array.Empty<DesktopRecoveryTab>())
    {
    }

    internal MainWindow(
        bool createInitialTab,
        IReadOnlyList<DesktopRecoveryTab>? recoveryTabs = null)
    {
        InstalledFonts.Warmup();
        _createInitialTab = createInitialTab;
        _recoveryTabs = recoveryTabs ?? Array.Empty<DesktopRecoveryTab>();
        InitializeComponent();
        Title = ProductTitle;
        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;
        Activated += (_, _) =>
        {
            _lastActiveWindow = this;
            _onlineLease.SetForeground(true);
            UpdateWindowMemoryTargets(foreground: true);
            if (_activeSession is { } active) _ = RefreshSaveTargetAsync(active);
        };
        Deactivated += (_, _) =>
        {
            _onlineLease.SetForeground(false);
            UpdateWindowMemoryTargets(foreground: false);
        };
        SizeChanged += (_, _) => QueueNativeTabWidthUpdate();
        NativeTabs.CollectionChanged += (_, args) =>
        {
            if (args.Action != NotifyCollectionChangedAction.Move) QueueNativeTabWidthUpdate();
            if (!_closing) SaveDesktopRecoveryManifest();
        };
        Closing += OnClosing;
        Closed += OnClosed;
        _onlineLease.Changed += OnOnlineLeaseChanged;
        _onlineLeaseTimer.Tick += (_, _) => _onlineLease.Tick();
        _idleTimer.Tick += OnIdleTimerTick;
        _startupProgressTimer.Tick += (_, _) =>
        {
            _startupProgressTimer.Stop();
            if (!_startupOverlayDismissed && StartupLoadingOverlay.Visibility == Visibility.Visible)
            {
                StartupLoadingProgress.Visibility = Visibility.Visible;
                StartupLoadingCloseButton.Visibility = Visibility.Visible;
            }
        };
        _startupReadyTimeoutTimer.Tick += (_, _) =>
        {
            _startupReadyTimeoutTimer.Stop();
            if (_startupOverlayDismissed || _closing) return;
            _startupProgressTimer.Stop();
            StartupLoadingProgress.Visibility = Visibility.Collapsed;
            MessageBox.Show(this,
                "편집기 초기화가 60초 안에 완료되지 않아 종료합니다.\n\n" +
                "임시 저장된 이전 작업은 삭제되지 않습니다.",
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        };
        _contentProgressTimer.Tick += (_, _) =>
        {
            _contentProgressTimer.Stop();
            if (LoadingOverlay.Visibility == Visibility.Visible)
                ContentLoadingProgress.Visibility = Visibility.Visible;
        };
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
    }

    public void EnqueueLaunchRequest(LaunchRequest request)
    {
        if (request.Files.Length == 0) return;
        _pendingRequests.Enqueue(request);
        ShellWindowActivation.BringToFront(this);
        request.ActivationWindow = Handle;
        _ = DrainPendingRequestsAsync();
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        Handle = new WindowInteropHelper(this).Handle;
        _hwndSource = HwndSource.FromHwnd(Handle);
        _hwndSource?.AddHook(WindowProc);
        OpenWindows[Handle] = this;
        TabRegistry.RegisterWindow(Handle);
        ApplyWindowsTitleBarTheme();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _startupProgressTimer.Start();
        _startupReadyTimeoutTimer.Start();
        _onlineLease.SetForeground(IsActive);
        _onlineLeaseTimer.Start();
        _idleTimer.Start();
        try
        {
            EnsureContentHostHandle();
            EnsureControllerParkingHostHandle();
            _environment = await BrowserRuntime.GetEnvironmentAsync();
            _initialized = true;
            if (_recoveryTabs.Count > 0)
            {
                _restoringDesktopTabs = true;
                try { await RestoreDesktopTabsAsync(); }
                finally { _restoringDesktopTabs = false; }
                SaveDesktopRecoveryManifest();
            }
            else if (_createInitialTab && NativeTabs.Count == 0)
                await CreateTabAsync(null, activate: true);
            await DrainPendingRequestsAsync();
        }
        catch (Exception error)
        {
            _startupProgressTimer.Stop();
            _startupReadyTimeoutTimer.Stop();
            StopContentProgressDelay();
            LoadingOverlay.Visibility = Visibility.Collapsed;
            StartupLoadingOverlay.Visibility = Visibility.Collapsed;
            StartupLoadingProgress.Visibility = Visibility.Collapsed;
            StartupLoadingCloseButton.Visibility = Visibility.Collapsed;
            MessageBox.Show(this,
                "Windows 편집기를 시작하지 못했습니다.\n\n" + error.Message,
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async Task<TabSession> CreateTabAsync(
        string? path,
        bool activate,
        bool pasteClipboardOnReady = false,
        string? titleOverride = null,
        Guid? sessionId = null,
        bool restoreFromAutosave = false)
    {
        if (_environment is null) throw new InvalidOperationException("WebView2 환경이 준비되지 않았습니다.");
        string title = titleOverride ?? (path is null ? "새 문서" : Path.GetFileNameWithoutExtension(DaydayPDF.Printing.PrintInbox.DisplayName(path)));
        var session = new TabSession(title, path, sessionId)
        {
            PendingOpenPath = restoreFromAutosave ? null : path,
            PasteClipboardOnReady = pasteClipboardOnReady,
            PendingClipboardTitle = titleOverride,
            RestoreFromAutosave = restoreFromAutosave
        };
        TabRegistry.Register(session, this);
        NativeTabs.Add(session);
        string stage = "WebView2 Controller 생성";
        try
        {
            CoreWebView2Controller controller =
                await _environment.CreateCoreWebView2ControllerAsync(EnsureControllerParkingHostHandle());
            if (session.Owner is not { } owner || owner._closing)
            {
                controller.Close();
                return session;
            }
            controller.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 12, 13, 15);
            session.Controller = controller;
            session.IsUnloaded = false;
            stage = "Controller 표시 설정";
            ParkController(session);
            stage = "로컬 편집기 연결";
            owner.ConfigureWebView(session);
            stage = "단일 문서 화면 탐색";
            string startup = restoreFromAutosave ? "&restore=1" :
                activate && path is not null ? "&opening=1" : string.Empty;
            controller.CoreWebView2.Navigate($"{LocalViewUrl}?tab={session.Id:N}{startup}");

            stage = "초기 탭 활성화";
            if ((activate && owner == this) || owner._activeSession == session)
            {
                owner.SelectOnlyNativeTab(session);
                owner.ActivateSession(session);
            }
            owner.RefreshTitle();
            if (!activate && owner.NativeTabs.Count > ControllerTrimThreshold) owner.TrimInactiveControllers();
            return session;
        }
        catch (Exception error)
        {
            var failedOwner = session.Owner;
            failedOwner?.NativeTabs.Remove(session);
            TabRegistry.Close(session, deleteTemporaryPrint: false);
            failedOwner?.RefreshTitle();
            throw new InvalidOperationException(
                $"{stage} 단계에서 실패했습니다. (HRESULT 0x{error.HResult:X8})\n{error.Message}", error);
        }
    }

    private async Task RestoreDesktopTabsAsync()
    {
        DesktopRecoveryTab[] tabs = _recoveryTabs
            .Where(tab => tab.Id != Guid.Empty)
            .GroupBy(tab => tab.Id)
            .Select(group => group.First())
            .ToArray();
        TabSession? activate = null;
        foreach (DesktopRecoveryTab saved in tabs)
        {
            TabSession session = await CreateTabAsync(
                saved.DocPath,
                activate: false,
                titleOverride: saved.Title,
                sessionId: saved.Id,
                restoreFromAutosave: true);
            if (activate is null || saved.Active) activate = session;
        }
        if (activate is not null)
        {
            SelectOnlyNativeTab(activate);
            ActivateSession(activate);
        }
        else if (NativeTabs.Count == 0)
        {
            await CreateTabAsync(null, activate: true);
        }
    }

    private void ConfigureWebView(TabSession session)
    {
        CoreWebView2 core = session.WebView
            ?? throw new InvalidOperationException("WebView2 컨트롤러가 없습니다.");
        string webRoot = AppContentLocator.WebRoot;
        string viewPath = Path.Combine(webRoot, "view.html");
        if (!File.Exists(viewPath))
            throw new FileNotFoundException("Windows 단일 문서 뷰를 찾지 못했습니다.", viewPath);

        core.SetVirtualHostNameToFolderMapping(
            LocalAppHost,
            webRoot,
            CoreWebView2HostResourceAccessKind.DenyCors);
        InstalledFonts.Attach(core, LocalAppHost);
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.NavigationStarting += (_, args) => session.Owner?.OnNavigationStarting(session, args);
        core.NavigationCompleted += (_, args) => session.Owner?.OnNavigationCompleted(session, args);
        core.WebMessageReceived += (_, args) => session.Owner?.OnWebMessageReceived(session, args);
        core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_, args) => args.Cancel = true;
        core.ProcessFailed += (_, args) => session.Owner?.Dispatcher.BeginInvoke(
            () => session.Owner?.OnProcessFailed(session, args.ProcessFailedKind.ToString()));
        core.NewWindowRequested += (_, args) => session.Owner?.OnNewWindowRequested(args);
        core.WindowCloseRequested += (_, _) => session.Owner?.Dispatcher.BeginInvoke(
            () => session.Owner?.CloseTabAsync(session));
    }

    private void OnNavigationStarting(TabSession session, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsTrustedViewUri(e.Uri)) return;
        e.Cancel = true;
        if (e.IsUserInitiated) OpenExternalUri(e.Uri);
    }

    private void OnNavigationCompleted(TabSession session, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess) return;
        if (session == _activeSession)
        {
            StopContentProgressDelay();
            _startupProgressTimer.Stop();
            _startupReadyTimeoutTimer.Stop();
            LoadingOverlay.Visibility = Visibility.Collapsed;
            StartupLoadingOverlay.Visibility = Visibility.Collapsed;
            StartupLoadingProgress.Visibility = Visibility.Collapsed;
            StartupLoadingCloseButton.Visibility = Visibility.Collapsed;
            MessageBox.Show(this,
                "내장 편집기 화면을 불러오지 못했습니다.\n\n" + e.WebErrorStatus,
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnProcessFailed(TabSession session, string failureKind)
    {
        if (session.Owner != this || !failureKind.EndsWith("RenderProcessExited", StringComparison.Ordinal)) return;
        bool wasActive = session == _activeSession;
        PendingIdleFlush.Remove(session.Id);
        session.CloseController();
        if (session.IsDirty || session.DocPath is null)
        {
            if (wasActive)
            {
                LoadingOverlay.Visibility = Visibility.Visible;
                LoadingStatusText.Text = "이 탭의 편집기 프로세스가 종료되었습니다.";
            }
            MessageBox.Show(this,
                $"\"{session.Title}\" 탭의 편집기 프로세스가 종료되었습니다.\n" +
                "다른 탭은 그대로 유지됩니다. 이 탭은 자동복구 데이터를 확인한 뒤 다시 열어 주세요.",
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        try
        {
            if (wasActive) LoadingStatusText.Text = "이 탭을 복구하는 중...";
            await ReloadUnloadedSessionAsync(session);
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "이 탭을 다시 열지 못했습니다.\n\n" + error.Message,
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void OnWebMessageReceived(TabSession session, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsTrustedViewUri(e.Source) || session.Owner is null) return;
        try
        {
            using JsonDocument message = JsonDocument.Parse(e.WebMessageAsJson);
            JsonElement root = message.RootElement;
            string type = GetString(root, "type") ?? string.Empty;
            string cmd = GetString(root, "cmd") ?? string.Empty;

            if (type is "update-state" or "update-toggle" or "update-check")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion || ((App)Application.Current).Updates is not { } updates) return;
                if (session.IsActive && type == "update-toggle") updates.SetEnabled(GetBoolean(root, "enabled"));
                if (session.IsActive && type == "update-check") updates.Check();
                SendHostCommand(session, updates.Snapshot);
                return;
            }
            if (type == "capture-color-sample" && GetInt32(root, "apiVersion") == HostApiVersion)
            {
                if (GetString(root, "requestId") is not { } requestId) return;
                if (session.IsActive && session.WebView is { } web && _environment is not null)
                {
                    try { await EditorColorSampler.PostFrameAsync(_environment, web, requestId); return; }
                    catch (Exception error) { System.Diagnostics.Debug.WriteLine(error.Message); }
                }
                SendHostCommand(session, new { cmd = "color-sample-error", requestId });
                return;
            }

            if (type is "output-printers" or "output-put" or "output-put-done" or "output-open-saved" or "output-resources" or "output-cancel")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion) return;
                if (type == "output-open-saved")
                {
                    string requestId = GetString(root, "requestId") ?? "";
                    try
                    {
                        if (!_savedOutputPdfs.TryGetValue(GetString(root, "savedRequestId") ?? "", out string? savedPath) || !IsReadablePdf(savedPath))
                            throw new InvalidOperationException("저장한 결과 PDF를 찾을 수 없습니다.");
                        await CreateTabAsync(savedPath, activate: true);
                        SendHostCommand(session, new { cmd = "output-result", requestId, ok = true });
                    }
                    catch (Exception error)
                    {
                        SendHostCommand(session, new { cmd = "output-result", requestId, ok = false, error = error.Message });
                    }
                }
                else if (type == "output-resources") SendPrintResources(session, root);
                else if (type == "output-cancel") CancelOutput(session, GetString(root, "requestId") ?? "");
                else if (type == "output-put") BeginOutputTransfer(session, root);
                else if (type == "output-put-done") await CompleteOutputTransferAsync(session, GetString(root, "requestId") ?? "");
                else
                {
                    string requestId = GetString(root, "requestId") ?? "";
                    try { SendHostCommand(session, new { cmd = "output-result", requestId, ok = true, printers = GetDesktopPrinters() }); }
                    catch (Exception error) { SendHostCommand(session, new { cmd = "output-result", requestId, ok = false, error = error.Message }); }
                }
                return;
            }

            if (type == "startup-error")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion) return;
                _startupProgressTimer.Stop();
                _startupReadyTimeoutTimer.Stop();
                StopContentProgressDelay();
                LoadingOverlay.Visibility = Visibility.Collapsed;
                StartupLoadingOverlay.Visibility = Visibility.Collapsed;
                StartupLoadingProgress.Visibility = Visibility.Collapsed;
                StartupLoadingCloseButton.Visibility = Visibility.Collapsed;
                MessageBox.Show(this,
                    "편집기를 불러오지 못했습니다.\n\n" +
                    (GetString(root, "message") ?? "알 수 없는 오류"),
                    ProductTitle, MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
                return;
            }

            if (type == "view-ready")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion) return;
                session.ViewReady = true;
                SetSessionMemoryTarget(session, IsActive && session == _activeSession);
                if (session.PendingOpenPath is null) _ = RefreshSaveTargetAsync(session);
                await PushAccessPolicyAsync(session);
                await SendPendingDocumentAsync(session);
                if (session.PasteClipboardOnReady)
                {
                    session.PasteClipboardOnReady = false;
                    SendHostCommand(session, new
                    {
                        cmd = "paste-from-shell",
                        title = session.PendingClipboardTitle ?? session.Title
                    });
                    session.PendingClipboardTitle = null;
                }
                if (session == _activeSession)
                {
                    StopContentProgressDelay();
                    AttachController(session);
                    LoadingOverlay.Visibility = Visibility.Collapsed;
                    SetContentHostVisible(true);
                    DismissStartupLoadingOverlay();
                }
                SendHostCommand(session, new { cmd = "dismiss-boot-splash" });
                SendWindowResizeState(session);
                await DrainPendingRequestsAsync();
                return;
            }

            if (type == "window-resize")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion || session != _activeSession) return;
                BeginWebViewWindowResize(GetString(root, "edge"));
                return;
            }

            if (type == "themeChanged")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion) return;
                string? requestedTheme = GetString(root, "theme");
                if (requestedTheme is "dark" or "light")
                    ApplyEditorThemeAcrossWindows(requestedTheme);
                return;
            }

            if (type == "document-ready")
            {
                string? requestId = GetString(root, "requestId");
                if (requestId is not null) ReleaseOutboundBuffer(requestId);
                if (root.TryGetProperty("ok", out JsonElement ok) && ok.ValueKind == JsonValueKind.True)
                {
                    if (!string.Equals(GetString(root, "purpose"), "merge-candidate",
                        StringComparison.Ordinal))
                    {
                        session.HasDocument = true;
                        session.PendingOpenPath = null;
                        if (GetString(root, "purpose") == "open-document") _ = RefreshSaveTargetAsync(session);
                    }
                }
                else if (root.TryGetProperty("error", out JsonElement error))
                {
                    if (string.Equals(GetString(root, "purpose"), "open-document",
                        StringComparison.Ordinal))
                    {
                        session.PendingOpenPath = null;
                        session.DocPath = null;
                        _ = RefreshSaveTargetAsync(session);
                        session.DocumentSent = false;
                        SaveDesktopRecoveryManifest();
                    }
                    MessageBox.Show(this, "PDF를 열지 못했습니다.\n\n" + error.GetString(),
                        ProductTitle, MessageBoxButton.OK, MessageBoxImage.Warning);
                }
                return;
            }

            if (type == "document-state")
            {
                session.Title = GetString(root, "title") ?? session.Title;
                session.IsDirty = GetBoolean(root, "dirty");
                session.HasHistory = GetBoolean(root, "hasHistory");
                session.HasDocument = GetBoolean(root, "hasDocument");
                session.Touch();
                if (session.RestoreFromAutosave)
                {
                    session.RestoreFromAutosave = false;
                    if (!session.HasDocument && !session.RestoreFallbackTried &&
                        IsReadablePdf(session.DocPath ?? string.Empty))
                    {
                        session.RestoreFallbackTried = true;
                        session.PendingOpenPath = session.DocPath;
                        session.DocumentSent = false;
                        await SendPendingDocumentAsync(session);
                    }
                }
                RefreshTitle();
                SaveDesktopRecoveryManifest();
                return;
            }

            if (type == "titleChanged")
            {
                session.Title = GetString(root, "title") ?? session.Title;
                RefreshTitle();
                SaveDesktopRecoveryManifest();
                return;
            }

            if (type == "dirtyChanged")
            {
                session.IsDirty = GetBoolean(root, "dirty");
                if (root.TryGetProperty("hasHistory", out _))
                    session.HasHistory = GetBoolean(root, "hasHistory");
                RefreshTitle();
                SaveDesktopRecoveryManifest();
                return;
            }

            if (type == "historyChanged")
            {
                session.Touch();
                session.HasHistory = GetBoolean(root, "hasHistory");
                return;
            }

            if (type == "recovery-policy")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion) return;
                DesktopRecoveryStore.SetEnabled(GetBoolean(root, "enabled"));
                if (DesktopRecoveryStore.Enabled) SaveDesktopRecoveryManifest();
                return;
            }

            if (type == "open-recovery-folder")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion) return;
                DesktopRecoveryStore.OpenFolder();
                return;
            }

            if (type == "close-confirmed")
            {
                string? requestId = GetString(root, "requestId");
                if (requestId is not null &&
                    _pendingCloseConfirmations.Remove(requestId, out TaskCompletionSource<string>? pending))
                    pending.TrySetResult(GetString(root, "choice") ?? (GetBoolean(root, "confirmed") ? "discard" : "cancel"));
                return;
            }

            if (type == "save-for-close-result")
            {
                string? requestId = GetString(root, "requestId");
                if (requestId is not null && _pendingCloseSaves.TryGetValue(requestId, out var pending) &&
                    pending.Session == session)
                    pending.Completion.TrySetResult(GetBoolean(root, "ok") && !session.IsDirty);
                return;
            }

            if (type == "multi-open-choice")
            {
                string? requestId = GetString(root, "requestId");
                if (requestId is not null &&
                    _pendingMultiOpenChoices.Remove(requestId,
                        out TaskCompletionSource<string?>? pending))
                {
                    string? mode = GetString(root, "mode");
                    pending.TrySetResult(mode is "tabs" or "merge" ? mode : null);
                }
                return;
            }

            if (type == "request-open")
            {
                OpenFilesFromDialog();
                return;
            }

            if (type == "drop-files")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion ||
                    !_onlineLease.Snapshot.CanOpenNewDocuments) return;
                string[] paths = e.AdditionalObjects.OfType<CoreWebView2File>()
                    .Select(file => file.Path)
                    .Where(IsReadablePdf)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();
                if (GetString(root, "target") == "merge")
                    await SendMergeCandidatesAsync(session, paths, resetList: false);
                else if (GetBoolean(root, "append") && session.HasDocument)
                    await SendAppendFilesAsync(session, paths);
                else
                    await OpenPathsWithChoiceAsync(paths);
                return;
            }

            if (type == "request-merge")
            {
                await MergeFilesFromDialogAsync(session);
                return;
            }

            if (type is "merge-tabs-list" or "merge-tab-snapshot")
            {
                if (GetInt32(root, "apiVersion") != HostApiVersion ||
                    !_onlineLease.Snapshot.CanOpenNewDocuments) return;
                string requestId = GetString(root, "requestId") ?? "";
                if (!Guid.TryParse(requestId, out _)) return;
                try
                {
                    if (type == "merge-tabs-list")
                    {
                        var documents = TabRegistry.All.Values.Where(tab => tab.Owner is not null && tab.HasDocument)
                            .Select(tab => new { id = tab.Id.ToString("N"), name = tab.Title }).ToArray();
                        SendHostCommand(session, new { cmd = "merge-tabs-result", requestId, documents });
                    }
                    else
                    {
                        if (!Guid.TryParse(GetString(root, "tabId"), out Guid id) ||
                            !TabRegistry.All.TryGetValue(id, out TabSession? source) || source.Owner is not { } owner)
                            throw new InvalidOperationException("열린 문서를 찾을 수 없습니다.");
                        if (source.Controller is null) await owner.ReloadUnloadedSessionAsync(source);
                        var wait = Stopwatch.StartNew();
                        while (!source.ViewReady || source.RestoreFromAutosave || source.PendingOpenPath is not null)
                        {
                            if (source.Owner is null || wait.Elapsed > TimeSpan.FromSeconds(45))
                                throw new InvalidOperationException("열린 문서를 불러올 수 없습니다.");
                            await Task.Delay(100);
                        }
                        if (!source.HasDocument) throw new InvalidOperationException("열린 문서를 찾을 수 없습니다.");
                        source.Touch();
                        SendHostCommand(source, new { cmd = "merge-snapshot-request", requestId });
                    }
                }
                catch (Exception error)
                {
                    SendHostCommand(session, new { cmd = "merge-tabs-result", requestId, error = error.Message });
                }
                return;
            }

            if (type is "requestClose" or "request-close")
            {
                await CloseTabAsync(session);
                return;
            }

            if (type == "save-put")
            {
                BeginSaveTransfer(session, root);
                return;
            }

            if (type == "save-put-done")
            {
                await CompleteSaveTransferAsync(session, GetString(root, "requestId"));
                return;
            }

            if (type == "clipboard-put")
            {
                BeginClipboardPut(session, root);
                return;
            }

            if (type == "clipboard-put-cancel")
            {
                if (GetString(root, "requestId") is string requestId)
                    ShellClipboardBroker.CancelPut(session, requestId);
                return;
            }

            if (type == "clipboard-put-done")
            {
                string? requestId = GetString(root, "requestId");
                if (requestId is not null) ShellClipboardBroker.CommitPut(session, requestId);
                return;
            }

            if (type == "clipboard-get")
            {
                string? requestId = GetString(root, "requestId");
                if (requestId is not null) ShellClipboardBroker.SendCurrent(session, requestId,
                    metadataOnly: GetBoolean(root, "metadataOnly"));
                return;
            }

            if (type == "request-new-from-clipboard")
            {
                string title = GetString(root, "title") ?? "새 문서";
                await CreateTabAsync(null, activate: true, pasteClipboardOnReady: true, titleOverride: title);
                if (GetBoolean(root, "replaceEmptyHost") && session.Owner == this &&
                    !session.HasDocument && !session.IsDirty)
                    await CloseTabAsync(session);
                return;
            }

            if (type == "flush-done" || cmd == "flush-done")
            {
                string? requestId = GetString(root, "requestId");
                session.IsDirty = GetBoolean(root, "dirty");
                session.HasHistory = GetBoolean(root, "hasHistory");
                bool succeeded = string.IsNullOrWhiteSpace(GetString(root, "error"));
                if (requestId is not null &&
                    _pendingFlushes.Remove(requestId, out TaskCompletionSource<bool>? pendingFlush))
                    pendingFlush.TrySetResult(succeeded);
                else
                    CompleteIdleFlush(session, requestId, succeeded);
            }
        }
        catch (JsonException)
        {
        }
        catch (Exception error)
        {
            Debug.WriteLine(error);
        }
    }

    private async Task DrainPendingRequestsAsync()
    {
        if (_drainingLaunchRequests || !_initialized || _environment is null || !_onlineLease.Snapshot.CanOpenNewDocuments) return;
        _drainingLaunchRequests = true;
        try
        {
            while (_pendingRequests.TryPeek(out LaunchRequest? request))
            {
                string[] valid = request.Files.Where(IsReadablePdf)
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                if (valid.Length == 0)
                {
                    _pendingRequests.Dequeue();
                    continue;
                }
                if ((request.Action == "merge" || valid.Length > 1) && GetReadyPromptSession() is null)
                    return;
                _pendingRequests.Dequeue();
                try
                {
                    if (request.Action == "merge") await MergeLaunchRequestAsync(valid);
                    else await OpenPathsWithChoiceAsync(valid);
                }
                catch (Exception error)
                {
                    MessageBox.Show(this, "PDF를 열지 못했습니다.\n\n" + error.Message, ProductTitle,
                        MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
        }
        finally { _drainingLaunchRequests = false; }
    }

    private TabSession? GetReadyPromptSession() =>
        _activeSession is { ViewReady: true, WebView: not null } active ? active :
        NativeTabs.FirstOrDefault(tab => tab.ViewReady && tab.WebView is not null);

    private async Task<string?> RequestMultiOpenChoiceAsync(TabSession session, int count)
    {
        string requestId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingMultiOpenChoices[requestId] = completion;
        SendHostCommand(session, new
        {
            cmd = "choose-multi-open",
            apiVersion = HostApiVersion,
            requestId,
            count
        });
        try
        {
            return await completion.Task;
        }
        finally
        {
            _pendingMultiOpenChoices.Remove(requestId);
        }
    }

    private async Task OpenPathsWithChoiceAsync(IEnumerable<string> paths)
    {
        string[] valid = FilterAlreadyOpenPaths(paths, out TabSession? existing);
        if (valid.Length == 0)
        {
            if (existing is not null) ActivateExistingSession(existing);
            return;
        }
        if (valid.Length <= 1)
        {
            await OpenPathsAsync(valid);
            return;
        }
        TabSession? promptSession = GetReadyPromptSession();
        if (promptSession is null) return;
        string? mode = await RequestMultiOpenChoiceAsync(promptSession, valid.Length);
        if (mode == "tabs") await OpenPathsAsync(valid);
        else if (mode == "merge") await SendMergeCandidatesAsync(promptSession, valid);
    }

    private async Task OpenPathsAsync(IEnumerable<string> paths)
    {
        string[] valid = paths.Where(IsReadablePdf).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (valid.Length == 0) return;
        TabSession? reusable = NativeTabs.Count == 1 && _activeSession is { } active &&
            !active.HasDocument && !active.IsDirty && active.PendingOpenPath is null ? active : null;
        TabSession? first = null, existing = null;
        foreach (string path in valid)
        {
            TabSession? duplicate = FindOpenSession(path);
            if (duplicate is not null)
            {
                existing ??= duplicate;
                continue;
            }
            TabSession session;
            if (reusable is not null)
            {
                session = reusable;
                reusable = null;
                session.Title = Path.GetFileNameWithoutExtension(DaydayPDF.Printing.PrintInbox.DisplayName(path));
                session.DocPath = path;
                session.PendingOpenPath = path;
                session.DocumentSent = false;
                await SendPendingDocumentAsync(session);
            }
            else
            {
                session = await CreateTabAsync(path, activate: false);
            }
            first ??= session;
        }
        if (first?.Owner == this)
        {
            SelectOnlyNativeTab(first);
            ActivateSession(first);
        }
        else if (existing is not null) ActivateExistingSession(existing);
    }

    private async Task MergeLaunchRequestAsync(string[] paths)
    {
        string[] valid = paths.Where(IsReadablePdf).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (valid.Length == 0) return;
        TabSession? promptSession = GetReadyPromptSession();
        if (promptSession is not null) await SendMergeCandidatesAsync(promptSession, valid);
    }

    private async Task SendPendingDocumentAsync(TabSession session)
    {
        if (!session.ViewReady || session.DocumentSent || session.PendingOpenPath is null) return;
        session.DocumentSent = true;
        try
        {
            await SendFileBufferAsync(session, session.PendingOpenPath, "open-document");
        }
        catch
        {
            session.DocumentSent = false;
            throw;
        }
    }

    private async Task SendAppendFilesAsync(TabSession session, IEnumerable<string> paths)
    {
        foreach (string path in paths.Where(IsReadablePdf))
            await SendFileBufferAsync(session, path, "append-document");
    }

    private async Task SendMergeCandidatesAsync(TabSession session, IEnumerable<string> paths, bool resetList = true)
    {
        bool reset = resetList;
        foreach (string path in paths.Where(IsReadablePdf))
        {
            await SendFileBufferAsync(session, path, "merge-candidate", reset);
            reset = false;
        }
    }

    private async Task SendFileBufferAsync(
        TabSession session, string path, string command, bool resetMerge = false)
    {
        if (_environment is null || session.WebView is null) return;
        var file = new FileInfo(path);
        await using var source = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.Read,
            1, FileOptions.Asynchronous | FileOptions.SequentialScan);
        long length = source.Length;
        if (length <= 0 || length > MaximumSharedFileSize)
            throw new IOException($"지원하지 않는 PDF 크기입니다: {file.Name}");
        if (command == "open-document")
            SendHostCommand(session, new { cmd = "prepare-document" });
        string requestId = Guid.NewGuid().ToString("N");
        CoreWebView2SharedBuffer buffer = _environment.CreateSharedBuffer((ulong)length);
        OutboundBuffers[requestId] = new OutboundBuffer(session, buffer);
        try
        {
            using (Stream destination = buffer.OpenStream())
            {
                await source.CopyToAsync(destination, 1024 * 1024);
                await destination.FlushAsync();
            }
            session.WebView.PostSharedBufferToScript(
                buffer,
                CoreWebView2SharedBufferAccess.ReadOnly,
                JsonSerializer.Serialize(new
                {
                    cmd = command,
                    requestId,
                    name = DaydayPDF.Printing.PrintInbox.DisplayName(file.FullName),
                    docPath = command == "open-document" && !session.IsTemporaryPrint ? file.FullName : null,
                    size = length,
                    resetMerge
                }));
        }
        catch
        {
            ReleaseOutboundBuffer(requestId);
            throw;
        }
    }

    private void ReleaseOutboundBuffer(string requestId)
    {
        if (!OutboundBuffers.Remove(requestId, out OutboundBuffer? pending)) return;
        pending.Buffer.Close();
    }

    private static Task<bool> CanSaveInPlaceAsync(TabSession session)
    {
        string? path = session.DocPath;
        if (string.IsNullOrWhiteSpace(path) || session.IsTemporaryPrint || DaydayPDF.Printing.PrintInbox.IsLegacyPrint(path) ||
            TabRegistry.All.Values.Any(tab => tab != session && PathsEqual(tab.DocPath, path)))
            return Task.FromResult(false);
        return Task.Run(() => PdfSaveTarget.CanReplace(path));
    }

    private async Task RefreshSaveTargetAsync(TabSession session)
    {
        if (!session.ViewReady) return;
        int revision = ++session.SaveTargetRevision;
        bool canSaveInPlace = await CanSaveInPlaceAsync(session);
        if (session.SaveTargetRevision == revision && session.Owner == this)
            SendHostCommand(session, new { cmd = "save-target", canSaveInPlace });
    }

    private void BeginSaveTransfer(TabSession session, JsonElement root)
    {
        string? requestId = GetString(root, "requestId");
        try
        {
            if (_environment is null || session.WebView is null)
                throw new InvalidOperationException("Windows 저장 채널이 준비되지 않았습니다.");
            long size = GetInt64(root, "size");
            if (string.IsNullOrWhiteSpace(requestId) || size <= 0 || size > MaximumSharedFileSize)
                throw new InvalidOperationException("저장할 PDF 데이터의 크기가 올바르지 않습니다.");
            if (PendingWrites.Remove(requestId, out PendingWrite? old)) old.Buffer.Close();
            CoreWebView2SharedBuffer buffer = _environment.CreateSharedBuffer((ulong)size);
            string suggestedName = GetString(root, "name") ?? (session.Title + ".pdf");
            PendingWrites[requestId] = new PendingWrite(
                session, buffer, suggestedName, GetBoolean(root, "saveAs"));
            session.WebView.PostSharedBufferToScript(
                buffer,
                CoreWebView2SharedBufferAccess.ReadWrite,
                JsonSerializer.Serialize(new { cmd = "save-buffer", requestId, size }));
        }
        catch (Exception error)
        {
            ShowSaveFailure(error);
            SendHostCommand(session, new
            {
                cmd = "save-result", requestId, ok = false,
                error = error.Message
            });
        }
    }

    private async Task CompleteSaveTransferAsync(TabSession session, string? requestId)
    {
        if (requestId is null || !PendingWrites.Remove(requestId, out PendingWrite? pending) ||
            pending.Session != session) return;
        try
        {
            bool saveInPlace = !pending.ForceSaveAs && await CanSaveInPlaceAsync(session);
            string? path = saveInPlace ? session.DocPath : null;
            if (string.IsNullOrWhiteSpace(path))
            {
                path = PromptForSavePath(pending.SuggestedName);
                if (path is null)
                {
                    SendHostCommand(session, new { cmd = "save-result", requestId, ok = false, canceled = true });
                    return;
                }
            }

            try
            {
                EnsureSaveTargetIsNotOwnedByAnotherTab(session, path);
                await WriteSharedBufferAtomicallyAsync(pending.Buffer, path);
            }
            catch (Exception firstError) when (saveInPlace)
            {
                SendHostCommand(session, new { cmd = "save-target", canSaveInPlace = false });
                path = PromptForSavePath(pending.SuggestedName);
                if (path is null)
                {
                    SendHostCommand(session, new
                    {
                        cmd = "save-result", requestId, ok = false, canceled = true,
                        error = firstError.Message
                    });
                    return;
                }
                EnsureSaveTargetIsNotOwnedByAnotherTab(session, path);
                await WriteSharedBufferAtomicallyAsync(pending.Buffer, path);
            }
            session.DocPath = Path.GetFullPath(path);
            session.Title = Path.GetFileNameWithoutExtension(path);
            session.ReleaseTemporaryPrint();
            _ = RefreshSaveTargetAsync(session);
            SaveDesktopRecoveryManifest();
            SendHostCommand(session, new
            {
                cmd = "save-result", requestId, ok = true,
                name = Path.GetFileName(path), docPath = session.DocPath
            });
        }
        catch (Exception error)
        {
            ShowSaveFailure(error);
            SendHostCommand(session, new
            {
                cmd = "save-result", requestId, ok = false,
                error = error.Message
            });
        }
        finally
        {
            pending.Buffer.Close();
        }
    }

    private string? PromptForSavePath(string suggestedName)
    {
        var dialog = new SaveFileDialog
        {
            AddExtension = true,
            DefaultExt = ".pdf",
            Filter = "PDF 문서 (*.pdf)|*.pdf",
            FileName = suggestedName,
            OverwritePrompt = true
        };
        return dialog.ShowDialog(this) == true ? dialog.FileName : null;
    }

    private static void EnsureSaveTargetIsNotOwnedByAnotherTab(TabSession session, string path)
    {
        string fullPath = Path.GetFullPath(path);
        if (DaydayPDF.Printing.PrintInbox.Contains(fullPath))
            throw new IOException("임시 인쇄 파일과 다른 위치 또는 이름으로 저장하세요.");
        TabSession? duplicate = TabRegistry.All.Values.FirstOrDefault(tab =>
            tab != session && PathsEqual(tab.DocPath, fullPath));
        if (duplicate is not null)
            throw new IOException($"같은 파일이 이미 다른 탭에서 열려 있습니다: {Path.GetFileName(fullPath)}");
    }

    private static async Task WriteSharedBufferAtomicallyAsync(CoreWebView2SharedBuffer buffer, string targetPath, CancellationToken token = default)
    {
        string fullPath = Path.GetFullPath(targetPath);
        string? directory = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            throw new DirectoryNotFoundException("저장 폴더를 찾을 수 없습니다.");
        string temporaryPath = Path.Combine(directory, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            using Stream source = buffer.OpenStream();
            using (var destination = new FileStream(
                temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough))
            {
                if (source.CanSeek) source.Seek(0, SeekOrigin.Begin);
                await source.CopyToAsync(destination, 1024 * 1024, token);
                destination.Flush(flushToDisk: true);
            }
            if ((ulong)new FileInfo(temporaryPath).Length != buffer.Size)
                throw new IOException("저장된 PDF 데이터의 크기가 원본과 일치하지 않습니다.");
            token.ThrowIfCancellationRequested();
            File.Move(temporaryPath, fullPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
        }
    }

    private void ShowSaveFailure(Exception error)
    {
        string message = string.IsNullOrWhiteSpace(error.Message)
            ? "알 수 없는 파일 쓰기 오류가 발생했습니다."
            : error.Message;
        MessageBox.Show(
            this,
            $"PDF 파일을 저장하지 못했습니다.\n\n{message}\n\n다른 폴더나 파일 이름으로 다시 시도해 주세요.",
            "PDF 저장 실패",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
    }

    private void BeginClipboardPut(TabSession session, JsonElement root)
    {
        string? requestId = GetString(root, "requestId");
        if (requestId is null) return;
        try
        {
            long size = GetInt64(root, "size");
            JsonElement metadata = root.TryGetProperty("meta", out JsonElement meta)
                ? meta.Clone() : JsonSerializer.SerializeToElement(new { });
            if (_environment is null || size <= 0 ||
                !ShellClipboardBroker.BeginPut(_environment, session, requestId, (ulong)size, metadata))
                SendHostCommand(session, new { cmd = "clipboard-put-rejected", requestId });
        }
        catch (Exception error)
        {
            SendHostCommand(session, new { cmd = "clipboard-put-rejected", requestId, error = error.Message });
        }
    }

    private void ActivateSession(TabSession session)
    {
        if (session.Owner != this || !NativeTabs.Contains(session)) return;
        TabSession? previous = _activeSession;
        if (previous is not null && previous != session)
            ParkController(previous);
        foreach (TabSession tab in NativeTabs)
            tab.IsActive = tab == session;
        _activeSession = session;
        PendingIdleFlush.Remove(session.Id);
        session.LastViewedTimestamp = Stopwatch.GetTimestamp();
        EnsureNativeTabVisible(session);
        session.Touch();
        AttachController(session);
        if (previous is not null && previous != session)
            SetSessionMemoryTarget(previous, normal: false);
        SetSessionMemoryTarget(session, IsActive);
        LoadingOverlay.Visibility = session.ViewReady ? Visibility.Collapsed : Visibility.Visible;
        LoadingStatusText.Text = string.Empty;
        if (session.ViewReady) StopContentProgressDelay();
        else BeginContentProgressDelay();
        SetContentHostVisible(true);
        if (session.ViewReady)
        {
            DismissStartupLoadingOverlay();
            SendHostCommand(session, new { cmd = "dismiss-boot-splash" });
            _ = RefreshSaveTargetAsync(session);
        }
        if (session.ViewReady)
            Dispatcher.BeginInvoke(() =>
            {
                if (_activeSession == session && session.Owner == this)
                    session.Controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
            });
        RefreshTitle();
        SaveDesktopRecoveryManifest();
        if (session.IsUnloaded) BeginReloadUnloadedSession(session);
        if (NativeTabs.Count > ControllerTrimThreshold) TrimInactiveControllers();
    }

    private void UpdateWindowMemoryTargets(bool foreground)
    {
        foreach (TabSession tab in NativeTabs)
            SetSessionMemoryTarget(tab, foreground && tab == _activeSession);
    }

    private static void SetSessionMemoryTarget(TabSession session, bool normal)
    {
        try
        {
            if (session.ViewReady) session.Owner?.SendHostCommand(session, new { cmd = "background-preview", paused = !normal });
            if (session.WebView is { } webView)
                webView.MemoryUsageTargetLevel = normal
                    ? CoreWebView2MemoryUsageTargetLevel.Normal
                    : CoreWebView2MemoryUsageTargetLevel.Low;
        }
        catch (COMException) { }
    }

    private async Task ReloadUnloadedSessionAsync(TabSession session)
    {
        if (session.Controller is not null) return;
        var task = session.ReloadTask ??= LoadRestoredControllerAsync(session);
        try { await task; }
        finally { if (ReferenceEquals(session.ReloadTask, task)) session.ReloadTask = null; }
    }

    private async Task LoadRestoredControllerAsync(TabSession session)
    {
        if (_environment is null || session.DocPath is null || session.Owner != this) return;
        session.IsUnloaded = false;
        session.PendingOpenPath = null;
        session.DocumentSent = false;
        session.RestoreFromAutosave = true;
        session.RestoreFallbackTried = false;
        try
        {
            CoreWebView2Controller controller =
                await _environment.CreateCoreWebView2ControllerAsync(EnsureControllerParkingHostHandle());
            if (session.Owner is not { } owner || owner._closing)
            {
                controller.Close();
                return;
            }
            controller.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 12, 13, 15);
            session.Controller = controller;
            ParkController(session);
            owner.ConfigureWebView(session);
            controller.CoreWebView2.Navigate($"{LocalViewUrl}?tab={session.Id:N}&restore=1");
            if (owner._activeSession == session) owner.ActivateSession(session);
        }
        catch
        {
            session.CloseController();
            throw;
        }
    }

    private async void BeginReloadUnloadedSession(TabSession session)
    {
        try
        {
            await ReloadUnloadedSessionAsync(session);
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "이 탭을 다시 열지 못했습니다.\n\n" + error.Message,
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async Task CloseTabAsync(TabSession session)
    {
        if (!NativeTabs.Contains(session) || _windowCloseConfirmationPending || _closingTabs.Count != 0) return;
        _closingTabs.Add(session.Id);
        try { await CloseTabCoreAsync(session); }
        finally { _closingTabs.Remove(session.Id); }
    }

    private async Task CloseTabCoreAsync(TabSession session)
    {
        if (session.IsDirty && !await ConfirmUnsavedChangesAsync(session)) return;

        if (!NativeTabs.Contains(session)) return;
        int index = NativeTabs.IndexOf(session);
        bool wasActive = ReferenceEquals(_activeSession, session);
        NativeTabs.Remove(session);
        if (wasActive) _activeSession = null;
        PendingIdleFlush.Remove(session.Id);
        ShellClipboardBroker.RemovePendingFor(session);
        TabRegistry.Close(session);
        SaveDesktopRecoveryManifest();
        if (NativeTabs.Count == 0)
        {
            await CreateTabAsync(null, activate: true);
            return;
        }
        if (wasActive)
        {
            TabSession next = NativeTabs[Math.Min(index, NativeTabs.Count - 1)];
            SelectOnlyNativeTab(next);
            ActivateSession(next);
            EnsureNativeTabVisible(next);
            return;
        }
        RefreshTitle();
        SaveDesktopRecoveryManifest();
    }

    private async Task<bool> ConfirmUnsavedChangesAsync(TabSession session)
    {
        if (session.Owner != this || !session.ViewReady || session.WebView is null) return false;
        ActivateSession(session);

        string requestId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingCloseConfirmations[requestId] = completion;
        SendHostCommand(session, new
        {
            cmd = "confirm-close", apiVersion = HostApiVersion, requestId,
            title = session.Title, temporaryPrint = session.IsTemporaryPrint, canSaveInPlace = await CanSaveInPlaceAsync(session)
        });
        try
        {
            string choice = await completion.Task;
            if (session.Owner != this) return false;
            if (choice is "save" or "save-as")
                return await SaveBeforeCloseAsync(session, saveAs: choice == "save-as");
            return choice == "discard";
        }
        finally
        {
            _pendingCloseConfirmations.Remove(requestId);
        }
    }

    private async Task<bool> SaveBeforeCloseAsync(TabSession session, bool saveAs)
    {
        if (!session.ViewReady || session.WebView is null) return false;
        string requestId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingCloseSaves[requestId] = (session, completion);
        SendHostCommand(session, new { cmd = "save-for-close", apiVersion = HostApiVersion, requestId, saveAs });
        try { return await completion.Task.WaitAsync(TimeSpan.FromMinutes(5)); }
        catch (TimeoutException) { return false; }
        finally { _pendingCloseSaves.Remove(requestId); }
    }

    private async Task ConfirmWindowCloseAsync()
    {
        _windowCloseConfirmationPending = true;
        try
        {
            TabSession[] candidates = NativeTabs.ToArray();
            var discarded = new Dictionary<Guid, long>();
            foreach (TabSession session in candidates)
            {
                if (!session.IsDirty || !NativeTabs.Contains(session)) continue;
                if (!await ConfirmUnsavedChangesAsync(session)) return;
                if (session.IsDirty) discarded[session.Id] = session.LastUsedTimestamp;
            }

            bool HasUnconfirmedTab() => NativeTabs.Any(tab => !candidates.Contains(tab) ||
                (tab.IsDirty && (!discarded.TryGetValue(tab.Id, out long stamp) || stamp != tab.LastUsedTimestamp)));
            if (IsLoaded && !HasUnconfirmedTab())
            {
                await FlushTabsForRecoveryAsync();
                if (HasUnconfirmedTab()) return;
                _discardedCloseTabs.UnionWith(discarded.Keys);
                SaveDesktopRecoveryManifest();
                _windowCloseAuthorized = true;
                Close();
            }
        }
        finally
        {
            _discardedCloseTabs.Clear();
            _windowCloseConfirmationPending = false;
            if (!_closing) SaveDesktopRecoveryManifest();
        }
    }

    private async Task FlushTabsForRecoveryAsync()
    {
        if (!DesktopRecoveryStore.Enabled) return;
        Task[] flushes = NativeTabs
            .Where(tab => tab.ViewReady && tab.WebView is not null)
            .Select(FlushSessionForRecoveryAsync)
            .ToArray();
        if (flushes.Length > 0) await Task.WhenAll(flushes);
        SaveDesktopRecoveryManifest();
    }

    private async Task FlushSessionForRecoveryAsync(TabSession session)
    {
        string requestId = $"close-{Guid.NewGuid():N}";
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingFlushes[requestId] = completion;
        SendHostCommand(session, new { cmd = "flush", requestId });
        try
        {
            await Task.WhenAny(completion.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        }
        finally
        {
            _pendingFlushes.Remove(requestId);
        }
    }

    private void MoveSessionTo(MainWindow target, TabSession session, int index = -1)
    {
        if (target == this)
        {
            ReorderSession(session, index);
            return;
        }
        if (session.Owner != this || target.Handle == IntPtr.Zero) return;
        try
        {
            bool movedActive = _activeSession == session;
            TabSession? replacement = movedActive
                ? ReplacementAfterMove([session], session)
                : _activeSession;
            TransferSessionOwnership(target, session, index);
            if (movedActive)
            {
                _activeSession = null;
                if (replacement is not null) { SelectOnlyNativeTab(replacement); ActivateSession(replacement); }
                else SetContentHostVisible(false);
            }
            target.SelectOnlyNativeTab(session);
            target.ActivateSession(session);
            RefreshTitle();
            if (NativeTabs.Count == 0) Dispatcher.BeginInvoke(Close);
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "탭을 이동하지 못했습니다.\n\n" + error.Message,
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void MoveSessionsTo(
        MainWindow target,
        IReadOnlyList<TabSession> sessions,
        int index,
        TabSession primary)
    {
        TabSession[] ordered = NativeTabs.Where(sessions.Contains).ToArray();
        if (ordered.Length == 0) return;
        if (target == this)
        {
            ReorderSessions(ordered, index);
            ActivateSession(ordered.Contains(primary) ? primary : ordered[0]);
            return;
        }
        try
        {
            bool movedActive = _activeSession is { } sourceActive && ordered.Contains(sourceActive);
            TabSession? replacement = movedActive
                ? ReplacementAfterMove(ordered, _activeSession!)
                : _activeSession;
            foreach (TabSession existing in target.NativeTabs) existing.IsSelected = false;
            int insertion = index < 0 ? target.NativeTabs.Count : Math.Clamp(index, 0, target.NativeTabs.Count);
            foreach (TabSession tab in ordered)
            {
                TransferSessionOwnership(target, tab, insertion++);
                tab.IsSelected = true;
            }
            if (movedActive)
            {
                _activeSession = null;
                if (replacement is not null) { SelectOnlyNativeTab(replacement); ActivateSession(replacement); }
                else SetContentHostVisible(false);
            }
            TabSession active = ordered.Contains(primary) ? primary : ordered[0];
            target.ActivateSession(active);
            RefreshTitle();
            if (NativeTabs.Count == 0) Dispatcher.BeginInvoke(Close);
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "탭을 이동하지 못했습니다.\n\n" + error.Message,
                ProductTitle, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private TabSession? ReplacementAfterMove(IReadOnlyList<TabSession> moved, TabSession active)
    {
        int index = NativeTabs.IndexOf(active);
        return NativeTabs.Where(tab => !moved.Contains(tab))
            .OrderByDescending(tab => tab.LastViewedTimestamp)
            .ThenBy(tab => Math.Abs(NativeTabs.IndexOf(tab) - index))
            .FirstOrDefault();
    }

    private void TransferSessionOwnership(MainWindow target, TabSession session, int index)
    {
        if (session.Owner != this || target == this)
            throw new InvalidOperationException("이동할 탭의 소유 창이 올바르지 않습니다.");
        target.EnsureContentHostHandle();
        if (session.Controller is not null)
        {
            _ = session.WebView?.ExecuteScriptAsync(
                "if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});");
            ParkController(session);
        }
        session.IsActive = false;
        session.LastViewedTimestamp = 0;
        NativeTabs.Remove(session);
        TabRegistry.AssignOwner(session, target, index);
        if (index < 0 || index > target.NativeTabs.Count) target.NativeTabs.Add(session);
        else target.NativeTabs.Insert(index, session);
    }

    private void ReorderSession(TabSession session, int requestedIndex)
    {
        ReorderSessions(new[] { session }, requestedIndex);
    }

    private void ReorderSessions(IReadOnlyList<TabSession> sessions, int requestedIndex)
    {
        var selected = sessions.Where(tab => tab.Owner == this && NativeTabs.Contains(tab)).ToHashSet();
        if (selected.Count == 0) return;
        TabSession[] ordered = NativeTabs.Where(selected.Contains).ToArray();
        var remaining = NativeTabs.Where(tab => !selected.Contains(tab)).ToList();
        int limit = Math.Clamp(requestedIndex, 0, NativeTabs.Count);
        int insertion = NativeTabs.Take(limit).Count(tab => !selected.Contains(tab));
        remaining.InsertRange(Math.Clamp(insertion, 0, remaining.Count), ordered);
        if (NativeTabs.SequenceEqual(remaining)) return;
        Dictionary<Guid, double> previousPositions = CaptureNativeTabLayoutPositions();
        for (int target = 0; target < remaining.Count; target++)
        {
            int from = NativeTabs.IndexOf(remaining[target]);
            if (from != target) NativeTabs.Move(from, target);
        }
        if (TabRegistry.ByWindow.TryGetValue(Handle, out List<Guid>? ids))
        {
            ids.Clear();
            ids.AddRange(NativeTabs.Select(tab => tab.Id));
        }
        AnimateNativeTabReorder(previousPositions, selected);
    }

    private Dictionary<Guid, double> CaptureNativeTabLayoutPositions()
    {
        var positions = new Dictionary<Guid, double>();
        double left = 0;
        foreach (TabSession tab in NativeTabs)
        {
            positions[tab.Id] = left;
            double width = NativeTabsList.ItemContainerGenerator.ContainerFromItem(tab) is FrameworkElement item &&
                item.ActualWidth > 0 ? item.ActualWidth : MinimumNativeTabWidth + 3;
            left += width;
        }
        return positions;
    }

    private void AnimateNativeTabReorder(
        IReadOnlyDictionary<Guid, double> previousPositions,
        IReadOnlySet<TabSession> movingTabs)
    {
        Dispatcher.BeginInvoke(() =>
        {
            Dictionary<Guid, double> currentPositions = CaptureNativeTabLayoutPositions();
            foreach (TabSession tab in NativeTabs)
            {
                if (movingTabs.Contains(tab) || !previousPositions.TryGetValue(tab.Id, out double previous) ||
                    !currentPositions.TryGetValue(tab.Id, out double current) ||
                    NativeTabsList.ItemContainerGenerator.ContainerFromItem(tab) is not FrameworkElement item) continue;
                double offset = previous - current;
                if (Math.Abs(offset) < .5) continue;
                var transform = new TranslateTransform(offset, 0);
                item.RenderTransform = transform;
                var animation = new DoubleAnimation(offset, 0, TimeSpan.FromMilliseconds(120))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                };
                animation.Completed += (_, _) =>
                {
                    if (ReferenceEquals(item.RenderTransform, transform))
                        item.RenderTransform = Transform.Identity;
                };
                transform.BeginAnimation(TranslateTransform.XProperty, animation);
            }
        }, DispatcherPriority.Render);
    }

    private void SelectOnlyNativeTab(TabSession session)
    {
        foreach (TabSession tab in NativeTabs) tab.IsSelected = tab == session;
        _nativeTabSelectionAnchor = session;
    }

    private void UpdateNativeTabSelection(TabSession session, ModifierKeys modifiers)
    {
        bool control = modifiers.HasFlag(ModifierKeys.Control);
        bool shift = modifiers.HasFlag(ModifierKeys.Shift);
        if (shift)
        {
            TabSession anchor = _nativeTabSelectionAnchor is { } saved && NativeTabs.Contains(saved)
                ? saved : (_activeSession ?? session);
            if (!control)
                foreach (TabSession tab in NativeTabs) tab.IsSelected = false;
            int first = NativeTabs.IndexOf(anchor);
            int last = NativeTabs.IndexOf(session);
            for (int index = Math.Min(first, last); index <= Math.Max(first, last); index++)
                NativeTabs[index].IsSelected = true;
            _nativeTabSelectionAnchor ??= anchor;
            return;
        }
        if (control)
        {
            session.IsSelected = !session.IsSelected;
            _nativeTabSelectionAnchor = session;
            return;
        }
        SelectOnlyNativeTab(session);
        _nativeTabSelectionAnchor = session;
        ActivateSession(session);
    }

    private TabSession[] GetNativeDragGroup(TabSession primary) =>
        primary.IsSelected
            ? NativeTabs.Where(tab => tab.IsSelected).ToArray()
            : new[] { primary };

    private void EnsureNativeTabVisible(TabSession session)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (_activeSession != session || !NativeTabs.Contains(session)) return;
            NativeTabsScroll.UpdateLayout();
            if (NativeTabsList.ItemContainerGenerator.ContainerFromItem(session) is FrameworkElement item)
            {
                Point position = item.TranslatePoint(new Point(0, 0), NativeTabsScroll);
                double current = NativeTabsScroll.HorizontalOffset;
                double viewport = NativeTabsScroll.ViewportWidth;
                double target = current;
                if (position.X < NativeTabsLeadingInset)
                    target += position.X - NativeTabsLeadingInset;
                else if (position.X + item.ActualWidth > viewport - NativeTabsTrailingInset)
                    target += position.X + item.ActualWidth - viewport + NativeTabsTrailingInset;
                NativeTabsScroll.ScrollToHorizontalOffset(
                    Math.Clamp(target, 0, NativeTabsScroll.ScrollableWidth));
            }
        }, DispatcherPriority.ContextIdle);
    }

    private void QueueNativeTabWidthUpdate()
    {
        if (_nativeTabWidthUpdateQueued) return;
        _nativeTabWidthUpdateQueued = true;
        Dispatcher.BeginInvoke(() =>
        {
            _nativeTabWidthUpdateQueued = false;
            UpdateNativeTabWidths();
        }, DispatcherPriority.Loaded);
    }

    private void UpdateNativeTabWidths()
    {
        if (!IsLoaded || NativeTabs.Count == 0) return;
        double available = NativeTabsScroll.ViewportWidth;
        if (double.IsNaN(available) || available <= 0) available = NativeTabsScroll.ActualWidth;
        double usable = Math.Max(1,
            available - NativeTabsLeadingInset - NativeTabsTrailingInset);
        double ideal = usable / NativeTabs.Count;
        double width;
        if (ideal >= MinimumNativeTabWidth)
        {
            width = Math.Min(220, ideal);
        }
        else
        {
            int visibleCount = Math.Max(1, (int)Math.Floor(usable / MinimumNativeTabWidth));
            width = Math.Clamp(usable / visibleCount, MinimumNativeTabWidth, 220);
        }
        for (int index = 0; index < NativeTabs.Count; index++)
        {
            if (NativeTabsList.ItemContainerGenerator.ContainerFromIndex(index) is DependencyObject item &&
                FindVisualChild<Border>(item) is { } border)
                border.Width = width;
        }
        Dispatcher.BeginInvoke(UpdateNativeTabEdgeFades, DispatcherPriority.Loaded);
    }

    private void OnNativeTabsScrollChanged(object sender, ScrollChangedEventArgs e) =>
        UpdateNativeTabEdgeFades();

    private void UpdateNativeTabEdgeFades()
    {
        NativeTabsLeftFade.Visibility = NativeTabsScroll.HorizontalOffset > .5
            ? Visibility.Visible : Visibility.Collapsed;
        NativeTabsRightFade.Visibility =
            NativeTabsScroll.HorizontalOffset < NativeTabsScroll.ScrollableWidth - .5
                ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnNativeTabsMouseWheel(object sender, MouseWheelEventArgs e)
    {
        if (NativeTabsScroll.ScrollableWidth <= 0) return;
        double step = MinimumNativeTabWidth;
        if (NativeTabsList.ItemContainerGenerator.ContainerFromIndex(0) is DependencyObject item &&
            FindVisualChild<Border>(item) is { ActualWidth: > 0 } tab)
            step = tab.ActualWidth;
        double current = NativeTabsScroll.HorizontalOffset;
        double targetIndex = e.Delta > 0
            ? Math.Ceiling(current / step) - 1
            : Math.Floor(current / step) + 1;
        NativeTabsScroll.ScrollToHorizontalOffset(
            Math.Clamp(targetIndex * step, 0, NativeTabsScroll.ScrollableWidth));
        e.Handled = true;
    }

    private int GetTabInsertionIndex(int screenX, int screenY)
    {
        try
        {
            Point local = NativeTabsList.PointFromScreen(new Point(screenX, screenY));
            double left = 0;
            for (int index = 0; index < NativeTabs.Count; index++)
            {
                if (NativeTabsList.ItemContainerGenerator.ContainerFromIndex(index) is not FrameworkElement item)
                    continue;
                if (local.X < left + item.ActualWidth / 2) return index;
                left += item.ActualWidth;
            }
        }
        catch (InvalidOperationException) { }
        return NativeTabs.Count;
    }

    private void OnNativeTabMiddleDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Middle || sender is not FrameworkElement tab) return;
        e.Handled = true;
        tab.CaptureMouse();
    }

    private void OnNativeTabMiddleUp(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Middle || sender is not FrameworkElement tab || !tab.IsMouseCaptured) return;
        e.Handled = true;
        bool inside = new Rect(tab.RenderSize).Contains(e.GetPosition(tab));
        tab.ReleaseMouseCapture();
        if (inside && tab.DataContext is TabSession session) _ = CloseTabAsync(session);
    }

    private void OnNativeTabMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (sender is not Border border || border.DataContext is not TabSession session ||
            FindVisualAncestor<Button>(e.OriginalSource as DependencyObject) is not null) return;
        _nativeTabDragStart = e.GetPosition(NativeChrome);
        _nativeTabDragSession = session;
        _nativeTabDragStarted = false;
        _nativeTabGrabOffsetX = Math.Clamp(e.GetPosition(border).X, 0, border.ActualWidth);
        _nativeTabClickModifiers = Keyboard.Modifiers;
        if ((_nativeTabClickModifiers & (ModifierKeys.Control | ModifierKeys.Shift)) != 0)
            UpdateNativeTabSelection(session, _nativeTabClickModifiers);
        _nativeTabDragGroup = GetNativeDragGroup(session);
        border.CaptureMouse();
        e.Handled = true;
    }

    private void OnNativeTabMouseMove(object sender, MouseEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed || _nativeTabDragSession is not { } session ||
            sender is not Border border) return;
        Point point = e.GetPosition(NativeChrome);
        if (!_nativeTabDragStarted &&
            Math.Abs(point.X - _nativeTabDragStart.X) < 6 &&
            Math.Abs(point.Y - _nativeTabDragStart.Y) < 6) return;
        _nativeTabDragStarted = true;
        TabSession[] dragGroup = (_nativeTabDragGroup ?? new[] { session })
            .Where(tab => tab.Owner == this && NativeTabs.Contains(tab)).ToArray();
        if (dragGroup.Length == 0) return;

        if (dragGroup.Length == NativeTabs.Count)
        {
            ClearNativeTabDragVisuals();
            border.ReleaseMouseCapture();
            _nativeTabDragSession = null;
            _nativeTabDragGroup = null;
            _nativeTabDragStarted = false;
            BeginWholeWindowTabDrag(dragGroup, session);
            e.Handled = true;
            return;
        }

        if (point.Y < -10 || point.Y > NativeChrome.ActualHeight + 10)
        {
            ClearNativeTabDragVisuals();
            border.ReleaseMouseCapture();
            _nativeTabDragSession = null;
            _nativeTabDragGroup = null;
            _nativeTabDragStarted = false;
            TearOffSessions(dragGroup, session);
            e.Handled = true;
            return;
        }

        if (!GetCursorPos(out NativePoint cursor)) return;
        Point scrollPoint = NativeTabsScroll.PointFromScreen(new Point(cursor.X, cursor.Y));
        ScrollNativeTabsForDrag(scrollPoint.X);
        ReorderSessions(dragGroup,
            GetTabInsertionIndex(cursor.X, cursor.Y));
        PositionNativeTabDragVisuals(dragGroup, session, cursor.X, cursor.Y);
    }

    private void PositionNativeTabDragVisuals(
        IReadOnlyCollection<TabSession> movingTabs,
        TabSession primary,
        int screenX,
        int screenY)
    {
        Dictionary<Guid, double> positions = CaptureNativeTabLayoutPositions();
        if (!positions.TryGetValue(primary.Id, out double primaryLeft)) return;
        Point pointer = NativeTabsList.PointFromScreen(new Point(screenX, screenY));
        double offset = pointer.X - _nativeTabGrabOffsetX - primaryLeft;
        foreach (TabSession tab in movingTabs)
        {
            if (NativeTabsList.ItemContainerGenerator.ContainerFromItem(tab) is not FrameworkElement item) continue;
            item.RenderTransform = new TranslateTransform(offset, 0);
            item.Opacity = .96;
            Panel.SetZIndex(item, 10);
            _nativeTabDragVisuals.Add(item);
        }
    }

    private void ClearNativeTabDragVisuals()
    {
        foreach (FrameworkElement item in _nativeTabDragVisuals)
        {
            item.RenderTransform = Transform.Identity;
            item.Opacity = 1;
            Panel.SetZIndex(item, 0);
        }
        _nativeTabDragVisuals.Clear();
    }

    private void ScrollNativeTabsForDrag(double pointerX)
    {
        const double edge = 48;
        double direction = pointerX < edge ? -1 : pointerX > NativeTabsScroll.ActualWidth - edge ? 1 : 0;
        if (direction == 0 || NativeTabsScroll.ScrollableWidth <= 0) return;
        double distance = direction < 0 ? edge - pointerX : pointerX - (NativeTabsScroll.ActualWidth - edge);
        double pressure = Math.Clamp(distance / edge, 0, 1);
        double amount = 8 + 32 * pressure;
        NativeTabsScroll.ScrollToHorizontalOffset(Math.Clamp(
            NativeTabsScroll.HorizontalOffset + direction * amount,
            0, NativeTabsScroll.ScrollableWidth));
    }

    private void BeginWholeWindowTabDrag(IReadOnlyList<TabSession> sessions, TabSession primary)
    {
        if (sessions.Count == 0 || sessions.Any(tab => tab.Owner != this) ||
            sessions.Count != NativeTabs.Count ||
            !GetCursorPos(out NativePoint cursor)) return;
        _tearOffDockCandidates = sessions.ToArray();
        _tearOffDockPrimary = primary;
        ReleaseCapture();
        SendMessage(Handle, WmNcLButtonDown, (IntPtr)HtCaption, MakeLParam(cursor.X, cursor.Y));
    }

    private void ContinueDockedTabDrag(
        IReadOnlyList<TabSession> sessions,
        TabSession primary,
        int attempts = 0)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (Mouse.LeftButton != MouseButtonState.Pressed || primary.Owner != this ||
                !NativeTabs.Contains(primary) || sessions.Any(tab => tab.Owner != this)) return;
            NativeTabsList.UpdateLayout();
            if (NativeTabsList.ItemContainerGenerator.ContainerFromItem(primary) is not DependencyObject item ||
                FindVisualChild<Border>(item) is not { } border)
            {
                if (attempts < 2) ContinueDockedTabDrag(sessions, primary, attempts + 1);
                return;
            }
            _nativeTabDragSession = primary;
            _nativeTabDragGroup = sessions.ToArray();
            _nativeTabDragStarted = true;
            _nativeTabGrabOffsetX = Math.Max(0, border.ActualWidth / 2);
            border.CaptureMouse();
            if (GetCursorPos(out NativePoint cursor))
                PositionNativeTabDragVisuals(sessions, primary, cursor.X, cursor.Y);
        }, DispatcherPriority.Render);
    }

    private ModifierKeys _nativeTabClickModifiers;

    private void OnNativeTabMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (!_nativeTabDragStarted && _nativeTabDragSession is { } clicked &&
            (_nativeTabClickModifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == 0)
            UpdateNativeTabSelection(clicked, ModifierKeys.None);
        ClearNativeTabDragVisuals();
        if (sender is Border border) border.ReleaseMouseCapture();
        _nativeTabDragSession = null;
        _nativeTabDragGroup = null;
        _nativeTabDragStarted = false;
    }

    private void TearOffSessions(IReadOnlyList<TabSession> sessions, TabSession primary)
    {
        TabSession[] ordered = NativeTabs.Where(sessions.Contains).ToArray();
        if (ordered.Length == 0 || ordered.Any(tab => tab.Owner != this) ||
            !GetCursorPos(out NativePoint cursor)) return;
        DpiScale dpi = VisualTreeHelper.GetDpi(this);
        double detachedWidth = Math.Max(MinWidth, ActualWidth);
        double detachedHeight = Math.Max(MinHeight, ActualHeight);
        var window = new MainWindow(createInitialTab: false)
        {
            Owner = this,
            WindowStartupLocation = WindowStartupLocation.Manual,
            Left = cursor.X / dpi.DpiScaleX - 180,
            Top = cursor.Y / dpi.DpiScaleY - TopResizeStripHeight - 16,
            Width = detachedWidth,
            Height = detachedHeight
        };
        window.Show();
        MoveSessionsTo(window, ordered, 0, primary);
        window.SelectOnlyNativeTab(primary);
        window._tearOffDockCandidates = ordered;
        window._tearOffDockPrimary = primary;
        ReleaseCapture();
        SendMessage(window.Handle, WmNcLButtonDown, (IntPtr)HtCaption, MakeLParam(cursor.X, cursor.Y));
    }

    private void OnNativeTabCloseClick(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.DataContext is TabSession session) _ = CloseTabAsync(session);
    }

    private bool _tabCloseBatchPending;

    private void OnNativeTabContextMenu(object sender, MouseButtonEventArgs e)
    {
        if (sender is not Border border || border.DataContext is not TabSession target ||
            !NativeTabs.Contains(target)) return;
        e.Handled = true;
        var menu = new ContextMenu
        {
            PlacementTarget = border,
            Placement = PlacementMode.MousePoint,
            Style = (Style)FindResource("NativeTabListMenuStyle")
        };
        Style itemStyle = (Style)FindResource("NativeTabListMenuItemStyle");
        foreach (var (command, label) in new[]
        {
            ("close", "닫기"), ("selected", "선택한 탭 닫기"),
            ("others", "다른 탭 모두 닫기"), ("left", "왼쪽 탭 모두 닫기"),
            ("right", "오른쪽 탭 모두 닫기"), ("all", "전부 닫기")
        })
        {
            TabSession[] targets = NativeTabClosePolicy.Select(NativeTabs.ToArray(), target,
                command, tab => tab.IsSelected);
            if (command == "selected" && targets.Length < 2) continue;
            var item = new MenuItem
            {
                Header = label, Style = itemStyle,
                IsEnabled = targets.Length > 0 && !_tabCloseBatchPending
            };
            item.Click += async (_, _) =>
            {
                if (_tabCloseBatchPending) return;
                _tabCloseBatchPending = true;
                try
                {
                    foreach (TabSession tab in targets)
                    {
                        if (!NativeTabs.Contains(tab)) continue;
                        await CloseTabAsync(tab);
                        if (NativeTabs.Contains(tab)) break;
                    }
                }
                finally { _tabCloseBatchPending = false; }
            };
            menu.Items.Add(item);
        }
        border.ContextMenu = menu;
        menu.Closed += (_, _) => border.ContextMenu = null;
        menu.IsOpen = true;
    }

    private void OnNativeTabDragOver(object sender, DragEventArgs e) => SetNativeTabDragEffect(e);
    private void OnNativeTabStripDragOver(object sender, DragEventArgs e) => SetNativeTabDragEffect(e);

    private static void SetNativeTabDragEffect(DragEventArgs e)
    {
        e.Effects = ReadNativeTabDrag(e.Data) is null ? DragDropEffects.None : DragDropEffects.Move;
        e.Handled = true;
    }

    private void OnNativeTabDrop(object sender, DragEventArgs e)
    {
        if ((sender as Border)?.DataContext is not TabSession target ||
            ReadNativeTabDrag(e.Data) is not Guid sessionId ||
            !TabRegistry.All.TryGetValue(sessionId, out TabSession? session) || session.Owner is null) return;
        int index = NativeTabs.IndexOf(target);
        if (e.GetPosition((Border)sender).X >= ((Border)sender).ActualWidth / 2) index++;
        session.Owner.MoveSessionTo(this, session, index);
        e.Handled = true;
    }

    private void OnNativeTabStripDrop(object sender, DragEventArgs e)
    {
        if (ReadNativeTabDrag(e.Data) is not Guid sessionId ||
            !TabRegistry.All.TryGetValue(sessionId, out TabSession? session) || session.Owner is null) return;
        Point screen = NativeTabsList.PointToScreen(e.GetPosition(NativeTabsList));
        session.Owner.MoveSessionTo(this, session,
            GetTabInsertionIndex((int)Math.Round(screen.X), (int)Math.Round(screen.Y)));
        e.Handled = true;
    }

    private static Guid? ReadNativeTabDrag(IDataObject? data)
    {
        if (data?.GetDataPresent(NativeTabDragFormat) != true) return null;
        return Guid.TryParse(data.GetData(NativeTabDragFormat) as string, out Guid id) ? id : null;
    }

    private async void OnNewTabClick(object sender, RoutedEventArgs e)
    {
        if (!_onlineLease.Snapshot.CanOpenNewDocuments || _environment is null) return;
        await CreateTabAsync(null, activate: true);
    }

    private void OnNativeThumbnailsClick(object sender, RoutedEventArgs e)
    {
        if (_activeSession is { ViewReady: true, WebView: not null } session)
            SendHostCommand(session, new { cmd = "toggle-thumbnails" });
    }

    private void OnNativeTabListClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button || NativeTabs.Count == 0) return;
        var menu = new ContextMenu
        {
            PlacementTarget = button,
            Placement = PlacementMode.Bottom,
            Style = (Style)FindResource("NativeTabListMenuStyle")
        };
        Style itemStyle = (Style)FindResource("NativeTabListMenuItemStyle");
        foreach (TabSession tab in NativeTabs)
        {
            string activeMark = tab == _activeSession ? "✓ " : "  ";
            string dirtyMark = tab.IsDirty ? "● " : string.Empty;
            var item = new MenuItem
            {
                Header = activeMark + dirtyMark + tab.Title,
                Tag = tab,
                Style = itemStyle,
                ToolTip = tab.TabToolTip
            };
            item.PreviewMouseDown += (_, e) =>
            {
                if (e.ChangedButton != MouseButton.Middle) return;
                e.Handled = true;
                menu.IsOpen = false;
                _ = CloseTabAsync(tab);
            };
            item.Click += (_, _) =>
            {
                if (item.Tag is TabSession selected && NativeTabs.Contains(selected))
                {
                    SelectOnlyNativeTab(selected);
                    ActivateSession(selected);
                    EnsureNativeTabVisible(selected);
                }
            };
            menu.Items.Add(item);
        }
        button.ContextMenu = menu;
        menu.Closed += (_, _) => button.ContextMenu = null;
        menu.IsOpen = true;
    }

    private void OnChromeMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (FindVisualAncestor<Button>(e.OriginalSource as DependencyObject) is not null ||
            FindVisualAncestor<Border>(e.OriginalSource as DependencyObject)?.DataContext is TabSession) return;
        if (e.ClickCount == 2)
        {
            ToggleMaximizeRestore();
            e.Handled = true;
            return;
        }
        if (e.ChangedButton == MouseButton.Left)
        {
            ReleaseCapture();
            SendMessage(Handle, WmNcLButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
            e.Handled = true;
        }
    }

    private void OnMinimizeClick(object sender, RoutedEventArgs e) => SystemCommands.MinimizeWindow(this);
    private void OnMaximizeRestoreClick(object sender, RoutedEventArgs e) => ToggleMaximizeRestore();
    private void OnCloseClick(object sender, RoutedEventArgs e) => SystemCommands.CloseWindow(this);

    private void ToggleMaximizeRestore()
    {
        if (WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(this);
        else SystemCommands.MaximizeWindow(this);
    }

    private void OnWindowStateChanged(object? sender, EventArgs e)
    {
        if (!IsLoaded) return;
        bool maximized = WindowState == WindowState.Maximized;
        MaximizeButton.Content = maximized ? "\uE923" : "\uE922";
        MaximizeButton.ToolTip = maximized ? "이전 크기로 복원" : "최대화";
        double resizeStrip = maximized ? 0 : TopResizeStripHeight;
        NativeChrome.Margin = new Thickness(0, resizeStrip, 0, 0);
        NativeChromeRow.Height = new GridLength(NativeCaptionHeight + resizeStrip);
        System.Windows.Shell.WindowChrome.GetWindowChrome(this).CaptionHeight = NativeCaptionHeight + resizeStrip;
        TopResizeGrip.Visibility = maximized ? Visibility.Collapsed : Visibility.Visible;
        TopLeftResizeGrip.Visibility = maximized ? Visibility.Collapsed : Visibility.Visible;
        TopRightResizeGrip.Visibility = maximized ? Visibility.Collapsed : Visibility.Visible;
        foreach (TabSession session in NativeTabs) SendWindowResizeState(session);
        QueueControllerHostUpdate(updateBounds: true);
    }

    private void OnTopResizeGripMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left) return;
        e.Handled = true;
        BeginWindowResize(HtTop);
    }

    private void OnTopLeftResizeGripMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left) return;
        e.Handled = true;
        BeginWindowResize(HtTopLeft);
    }

    private void OnTopRightResizeGripMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left) return;
        e.Handled = true;
        BeginWindowResize(HtTopRight);
    }

    private void SendWindowResizeState(TabSession session)
    {
        if (!session.ViewReady) return;
        SendHostCommand(session, new
        {
            cmd = "set-window-resize-enabled",
            enabled = WindowState == WindowState.Normal
        });
    }

    private void BeginWebViewWindowResize(string? edge)
    {
        int hitTest = edge switch
        {
            "left" => HtLeft,
            "right" => HtRight,
            "bottom" => HtBottom,
            "bottom-left" => HtBottomLeft,
            "bottom-right" => HtBottomRight,
            _ => 0
        };
        if (hitTest == 0) return;
        BeginWindowResize(hitTest);
    }

    private void BeginWindowResize(int hitTest)
    {
        if (WindowState != WindowState.Normal || !GetCursorPos(out NativePoint cursor)) return;
        ReleaseCapture();
        SendMessage(Handle, WmNcLButtonDown, (IntPtr)hitTest, MakeLParam(cursor.X, cursor.Y));
    }

    private void OnWindowDragOver(object sender, DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private async void OnWindowDrop(object sender, DragEventArgs e)
    {
        if (!_onlineLease.Snapshot.CanOpenNewDocuments ||
            e.Data.GetData(DataFormats.FileDrop) is not string[] files) return;
        e.Handled = true;
        if (_activeSession is { ViewReady: true, WebView: { } view } active &&
            await view.ExecuteScriptAsync("document.getElementById('mgOverlay')?.classList.contains('show') === true") == "true")
            await SendMergeCandidatesAsync(active, files, resetList: false);
        else await OpenPathsWithChoiceAsync(files);
    }

    private void OpenFilesFromDialog()
    {
        var dialog = new OpenFileDialog
        {
            Filter = "PDF 문서 (*.pdf)|*.pdf",
            Multiselect = true,
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) == true) _ = OpenPathsWithChoiceAsync(dialog.FileNames);
    }

    private async Task MergeFilesFromDialogAsync(TabSession session)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "PDF 문서 (*.pdf)|*.pdf",
            Multiselect = true,
            CheckFileExists = true,
            Title = "현재 문서에 병합할 PDF 선택"
        };
        if (dialog.ShowDialog(this) == true) await SendAppendFilesAsync(session, dialog.FileNames);
    }

    private void UpdateControllerBounds()
    {
        UpdateContentHostBounds();
        if (_activeSession is { } active) UpdateControllerBounds(active);
    }

    private void UpdateControllerBounds(TabSession session)
    {
        if (session != _activeSession || session.Controller is null ||
            _contentHostHandle == IntPtr.Zero || !WebViewBoundsElement.IsLoaded) return;
        try
        {
            DpiScale dpi = VisualTreeHelper.GetDpi(WebViewBoundsElement);
            int width = Math.Max(1, (int)Math.Round(WebViewBoundsElement.ActualWidth * dpi.DpiScaleX));
            int height = Math.Max(1, (int)Math.Round(WebViewBoundsElement.ActualHeight * dpi.DpiScaleY));
            session.Controller.Bounds = new DrawingRectangle(0, 0, width, height);
        }
        catch (InvalidOperationException) { }
        catch (ArgumentException) { }
        catch (COMException) { }
    }

    private void EnsureContentHostHandle()
    {
        if (_contentHostHandle != IntPtr.Zero && IsWindow(_contentHostHandle)) return;
        if (Handle == IntPtr.Zero) Handle = new WindowInteropHelper(this).EnsureHandle();
        _contentHostHandle = CreateWindowEx(
            0,
            "Static",
            null,
            WsChild | WsClipSiblings | WsClipChildren,
            0, 0, 1, 1,
            Handle,
            IntPtr.Zero,
            IntPtr.Zero,
            IntPtr.Zero);
        if (_contentHostHandle == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "WebView2 콘텐츠 호스트 HWND를 만들지 못했습니다.");
        UpdateContentHostBounds();
    }

    private static IntPtr EnsureControllerParkingHostHandle()
    {
        if (_controllerParkingHostHandle != IntPtr.Zero && IsWindow(_controllerParkingHostHandle))
            return _controllerParkingHostHandle;
        _controllerParkingHostHandle = CreateWindowEx(
            WsExToolWindow | WsExNoActivate,
            "Static",
            null,
            WsPopup | WsClipSiblings | WsClipChildren,
            -32000, -32000, 1, 1,
            IntPtr.Zero,
            IntPtr.Zero,
            IntPtr.Zero,
            IntPtr.Zero);
        if (_controllerParkingHostHandle == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "WebView2 숨은 주차 호스트 HWND를 만들지 못했습니다.");
        ShowWindow(_controllerParkingHostHandle, SwHide);
        return _controllerParkingHostHandle;
    }

    private static void ParkController(TabSession session)
    {
        if (session.Controller is not { } controller) return;
        controller.IsVisible = false;
        SetSessionMemoryTarget(session, normal: false);
        IntPtr parkingHost = EnsureControllerParkingHostHandle();
        if (controller.ParentWindow != parkingHost)
            controller.ParentWindow = parkingHost;
        if (controller.Bounds.Width < 96 || controller.Bounds.Height < 96)
        {
            var element = session.Owner?.WebViewBoundsElement;
            var dpi = element is null ? new DpiScale(1, 1) : VisualTreeHelper.GetDpi(element);
            controller.Bounds = new DrawingRectangle(0, 0,
                Math.Max(800, (int)Math.Round((element?.ActualWidth ?? 1000) * dpi.DpiScaleX)),
                Math.Max(600, (int)Math.Round((element?.ActualHeight ?? 800) * dpi.DpiScaleY)));
        }
        controller.NotifyParentWindowPositionChanged();
    }

    private void AttachController(TabSession session)
    {
        if (session.Controller is not { } controller) return;
        EnsureContentHostHandle();
        controller.IsVisible = false;
        if (controller.ParentWindow != _contentHostHandle)
            controller.ParentWindow = _contentHostHandle;
        UpdateControllerBounds(session);
        controller.NotifyParentWindowPositionChanged();
        controller.IsVisible = true;
        SendWindowResizeState(session);
    }

    internal static void ShutdownControllerParkingHost()
    {
        foreach (TabSession session in TabRegistry.All.Values.ToArray())
            session.CloseController();
        if (_controllerParkingHostHandle == IntPtr.Zero) return;
        if (IsWindow(_controllerParkingHostHandle)) DestroyWindow(_controllerParkingHostHandle);
        _controllerParkingHostHandle = IntPtr.Zero;
    }

    private void UpdateContentHostBounds()
    {
        if (_contentHostHandle == IntPtr.Zero || Handle == IntPtr.Zero || !WebViewBoundsElement.IsLoaded) return;
        try
        {
            Point screen = WebViewBoundsElement.PointToScreen(new Point(0, 0));
            var native = new NativePoint { X = (int)Math.Round(screen.X), Y = (int)Math.Round(screen.Y) };
            ScreenToClient(Handle, ref native);
            DpiScale dpi = VisualTreeHelper.GetDpi(WebViewBoundsElement);
            int width = Math.Max(1, (int)Math.Round(WebViewBoundsElement.ActualWidth * dpi.DpiScaleX));
            int height = Math.Max(1, (int)Math.Round(WebViewBoundsElement.ActualHeight * dpi.DpiScaleY));
            SetWindowPos(
                _contentHostHandle, IntPtr.Zero,
                native.X, native.Y, width, height,
                SwpNoZOrder | SwpNoActivate);
        }
        catch (InvalidOperationException) { }
    }

    private void SetContentHostVisible(bool visible)
    {
        if (_contentHostHandle != IntPtr.Zero) ShowWindow(_contentHostHandle, visible ? SwShow : SwHide);
    }

    private void DismissStartupLoadingOverlay()
    {
        if (_startupOverlayDismissed || StartupLoadingOverlay.Visibility != Visibility.Visible) return;
        _startupOverlayDismissed = true;
        _startupProgressTimer.Stop();
        _startupReadyTimeoutTimer.Stop();
        StartupLoadingProgress.Visibility = Visibility.Collapsed;
        StartupLoadingCloseButton.Visibility = Visibility.Collapsed;
        var animation = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(360))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut },
            FillBehavior = FillBehavior.Stop
        };
        animation.Completed += (_, _) =>
        {
            StartupLoadingOverlay.Visibility = Visibility.Collapsed;
            StartupLoadingOverlay.Opacity = 1;
        };
        StartupLoadingOverlay.BeginAnimation(OpacityProperty, animation);
    }

    private void BeginContentProgressDelay()
    {
        _contentProgressTimer.Stop();
        ContentLoadingProgress.Visibility = Visibility.Collapsed;
        _contentProgressTimer.Start();
    }

    private void StopContentProgressDelay()
    {
        _contentProgressTimer.Stop();
        ContentLoadingProgress.Visibility = Visibility.Collapsed;
    }

    private void NotifyControllersOfParentMove()
    {
        try { _activeSession?.Controller?.NotifyParentWindowPositionChanged(); }
        catch (InvalidOperationException) { }
        catch (ArgumentException) { }
        catch (COMException) { }
    }

    private void QueueControllerHostUpdate(bool updateBounds)
    {
        _controllerBoundsUpdatePending |= updateBounds;
        if (_controllerHostUpdateQueued) return;
        _controllerHostUpdateQueued = true;
        Dispatcher.BeginInvoke(() =>
        {
            _controllerHostUpdateQueued = false;
            bool shouldUpdateBounds = _controllerBoundsUpdatePending;
            _controllerBoundsUpdatePending = false;
            if (!IsLoaded) return;
            if (shouldUpdateBounds)
            {
                UpdateContentHostBounds();
                if (_activeSession is { } active) UpdateControllerBounds(active);
            }
            NotifyControllersOfParentMove();
        }, DispatcherPriority.Render);
    }

    private async Task PushAccessPolicyAsync(TabSession session)
    {
        if (!session.ViewReady) return;
        SendHostCommand(session, new { cmd = "set-access-policy", policy = _onlineLease.Snapshot });
        await Task.CompletedTask;
    }

    private void SendHostCommand(TabSession session, object command)
    {
        try { session.WebView?.PostWebMessageAsJson(JsonSerializer.Serialize(command, WebJsonOptions)); }
        catch (InvalidOperationException) { }
    }

    private void OnOnlineLeaseChanged(object? sender, EventArgs e)
    {
        _ = Dispatcher.InvokeAsync(async () =>
        {
            foreach (TabSession session in NativeTabs) await PushAccessPolicyAsync(session);
            if (_onlineLease.Snapshot.CanOpenNewDocuments) await DrainPendingRequestsAsync();
        });
    }

    private void OnIdleTimerTick(object? sender, EventArgs e) => TrimInactiveControllers();

    private void TrimInactiveControllers()
    {
        if (_closing) return;
        bool lowMemory = IsPhysicalMemoryLow();
        if (lowMemory)
        {
            foreach (var tab in NativeTabs)
                if (tab.ViewReady && (tab != _activeSession || !IsActive))
                    SendHostCommand(tab, new { cmd = "trim-preview-cache" });
        }
        if (!DesktopRecoveryStore.Enabled) return;
        bool overBudget = NativeTabs.Count(tab => tab.Controller is not null) > ControllerTrimThreshold;
        HashSet<Guid> recentInactive = GetRecentInactiveControllerIds();
        foreach (TabSession session in NativeTabs.OrderBy(tab => tab.LastUsedTimestamp))
        {
            if (session == _activeSession || session == _printPreparationOwner || !session.CanUnloadPreview ||
                (!lowMemory && recentInactive.Contains(session.Id))) continue;
            if (PendingIdleFlush.TryGetValue(session.Id, out var pending))
            {
                if (Stopwatch.GetElapsedTime(pending.StartedTimestamp) < IdleFlushTimeout) continue;
                PendingIdleFlush.Remove(session.Id);
            }
            var idle = Stopwatch.GetElapsedTime(session.LastUsedTimestamp);
            if (lowMemory ? idle < TimeSpan.FromSeconds(15) : !overBudget && idle < IdleUnloadAfter) continue;
            if (lowMemory && PendingIdleFlush.Values.Any(f => Stopwatch.GetElapsedTime(f.StartedTimestamp) < IdleFlushTimeout)) return;
            string requestId = $"idle-{session.Id:N}-{Guid.NewGuid():N}";
            PendingIdleFlush[session.Id] = (requestId, Stopwatch.GetTimestamp());
            SendHostCommand(session, new { cmd = "flush", requestId });
            if (lowMemory) return;
        }
    }

    private HashSet<Guid> GetRecentInactiveControllerIds() => NativeTabs
        .Where(session => session != _activeSession && session.Controller is not null)
        .OrderByDescending(session => session.LastUsedTimestamp)
        .Take(RecentInactiveControllerCount)
        .Select(session => session.Id)
        .ToHashSet();

    private void CompleteIdleFlush(TabSession session, string? requestId, bool flushSucceeded)
    {
        if (requestId is null ||
            !PendingIdleFlush.TryGetValue(session.Id, out var pending) ||
            !string.Equals(pending.RequestId, requestId, StringComparison.Ordinal)) return;
        PendingIdleFlush.Remove(session.Id);
        if (!flushSucceeded || !DesktopRecoveryStore.Enabled || session.Owner != this ||
            session == _activeSession || session == _printPreparationOwner || !session.CanUnloadPreview ||
            (!IsPhysicalMemoryLow() && GetRecentInactiveControllerIds().Contains(session.Id))) return;
        session.CloseController();
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Suspend) _onlineLease.Suspend();
        else if (e.Mode == PowerModes.Resume) _onlineLease.Resume();
    }

    private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (e.Category is UserPreferenceCategory.General or UserPreferenceCategory.VisualStyle)
            Dispatcher.Invoke(ApplyWindowsTitleBarTheme);
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_closing) return;
        if (_windowCloseConfirmationPending && !_windowCloseAuthorized) { e.Cancel = true; return; }
        TabSession[] dirty = NativeTabs.Where(tab => tab.IsDirty).ToArray();
        if (dirty.Length > 0 && !_windowCloseAuthorized)
        {
            e.Cancel = true;
            if (!_windowCloseConfirmationPending && _closingTabs.Count == 0)
                _ = ConfirmWindowCloseAsync();
            return;
        }
        _closing = true;
        _onlineLeaseTimer.Stop();
        _idleTimer.Stop();
        foreach (TabSession session in NativeTabs.ToArray())
        {
            PendingIdleFlush.Remove(session.Id);
            ShellClipboardBroker.RemovePendingFor(session);
            TabRegistry.Close(session);
        }
        NativeTabs.Clear();
        foreach (string requestId in OutboundBuffers
            .Where(pair => pair.Value.Session.Owner is null)
            .Select(pair => pair.Key).ToArray()) ReleaseOutboundBuffer(requestId);
        foreach (string requestId in PendingWrites
            .Where(pair => pair.Value.Session.Owner is null)
            .Select(pair => pair.Key).ToArray())
        {
            if (PendingWrites.Remove(requestId, out PendingWrite? pending)) pending.Buffer.Close();
        }
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _startupProgressTimer.Stop();
        _startupReadyTimeoutTimer.Stop();
        _contentProgressTimer.Stop();
        foreach (TaskCompletionSource<string> pending in _pendingCloseConfirmations.Values)
            pending.TrySetResult("cancel");
        _pendingCloseConfirmations.Clear();
        foreach (var pending in _pendingCloseSaves.Values) pending.Completion.TrySetResult(false);
        _pendingCloseSaves.Clear();
        _activePrint?.Cancel();
        foreach (var transfer in _outputTransfers.Values) transfer.Buffer.Close();
        _outputTransfers.Clear();
        foreach (TaskCompletionSource<string?> pending in _pendingMultiOpenChoices.Values)
            pending.TrySetResult(null);
        _pendingMultiOpenChoices.Clear();
        foreach (TaskCompletionSource<bool> pending in _pendingFlushes.Values)
            pending.TrySetResult(false);
        _pendingFlushes.Clear();
        _onlineLease.Changed -= OnOnlineLeaseChanged;
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        _hwndSource?.RemoveHook(WindowProc);
        if (_contentHostHandle != IntPtr.Zero)
        {
            DestroyWindow(_contentHostHandle);
            _contentHostHandle = IntPtr.Zero;
        }
        OpenWindows.Remove(Handle);
        if (_lastActiveWindow == this) _lastActiveWindow = null;
        if (Application.Current.MainWindow == this && GetPreferredLaunchWindow() is { } replacement)
            Application.Current.MainWindow = replacement;
        TabRegistry.UnregisterWindow(Handle);
    }

    private IntPtr WindowProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        switch (message)
        {
            case WmGetMinMaxInfo:
                ApplyMinMaxInfo(hwnd, lParam);
                handled = true;
                break;
            case WmMove:
                break;
            case WmSize:
            case WmDpiChanged:
                QueueControllerHostUpdate(updateBounds: true);
                break;
            case WmMoving:
                QueueLiveDockIfNeeded();
                break;
            case WmExitSizeMove:
                QueueControllerHostUpdate(updateBounds: true);
                TryDockTornOffWindow();
                break;
        }
        return IntPtr.Zero;
    }

    private void QueueLiveDockIfNeeded()
    {
        TabSession[] sessions = _tearOffDockCandidates?
            .Where(tab => tab.Owner == this && NativeTabs.Contains(tab)).ToArray() ?? Array.Empty<TabSession>();
        if (_liveDockQueued || sessions.Length == 0 || !GetCursorPos(out NativePoint cursor)) return;
        TabSession primary = _tearOffDockPrimary is { } candidate && sessions.Contains(candidate)
            ? candidate : sessions[0];
        MainWindow? target = OpenWindows.Values.FirstOrDefault(window =>
            window != this && window.IsPointOverTabStrip(cursor.X, cursor.Y));
        if (target is null) return;
        int index = target.GetTabInsertionIndex(cursor.X, cursor.Y);
        _liveDockQueued = true;
        _tearOffDockCandidates = null;
        _tearOffDockPrimary = null;
        ReleaseCapture();
        SendMessage(Handle, WmCancelMode, IntPtr.Zero, IntPtr.Zero);
        Dispatcher.BeginInvoke(() =>
        {
            try
            {
                if (sessions.Any(tab => tab.Owner != this) ||
                    !OpenWindows.TryGetValue(target.Handle, out MainWindow? liveTarget) ||
                    !ReferenceEquals(liveTarget, target)) return;
                Owner = null;
                MoveSessionsTo(target, sessions, index, primary);
                if (sessions.Any(tab => tab.Owner != target)) return;
                if (NativeTabs.Count == 0) Hide();
                target.Activate();
                target.ContinueDockedTabDrag(sessions, primary);
            }
            finally
            {
                _liveDockQueued = false;
            }
        }, DispatcherPriority.Input);
    }

    private void TryDockTornOffWindow()
    {
        TabSession[] sessions = _tearOffDockCandidates?
            .Where(tab => tab.Owner == this && NativeTabs.Contains(tab)).ToArray() ?? Array.Empty<TabSession>();
        TabSession primary = _tearOffDockPrimary is { } candidate && sessions.Contains(candidate)
            ? candidate : sessions.FirstOrDefault()!;
        _tearOffDockCandidates = null;
        _tearOffDockPrimary = null;
        if (sessions.Length == 0 || !GetCursorPos(out NativePoint cursor)) return;
        MainWindow? target = OpenWindows.Values.FirstOrDefault(window =>
            window != this && window.IsPointOverTabStrip(cursor.X, cursor.Y));
        Owner = null;
        if (target is not null)
        {
            int index = target.GetTabInsertionIndex(cursor.X, cursor.Y);
            MoveSessionsTo(target, sessions, index, primary);
            target.Activate();
        }
    }

    private bool IsPointOverTabStrip(int screenX, int screenY)
    {
        if (!IsVisible || WindowState == WindowState.Minimized) return false;
        try
        {
            Point topLeft = NativeChrome.PointToScreen(new Point(0, 0));
            Point bottomRight = NativeChrome.PointToScreen(
                new Point(Math.Max(0, NativeChrome.ActualWidth - 138), NativeChrome.ActualHeight));
            return screenX >= topLeft.X && screenX <= bottomRight.X &&
                screenY >= topLeft.Y && screenY <= bottomRight.Y;
        }
        catch (InvalidOperationException) { return false; }
    }

    private void RefreshTitle()
    {
        TabSession? active = _activeSession;
        Title = active is null ? ProductTitle : $"{active.Title}.pdf — {ProductTitle}";
    }

    private static void SaveDesktopRecoveryManifest()
    {
        if (!DesktopRecoveryStore.Enabled || OpenWindows.Values.Any(window => window._restoringDesktopTabs)) return;
        MainWindow? activeWindow = GetPreferredLaunchWindow();
        DesktopRecoveryTab[] tabs = OpenWindows.Values
            .SelectMany(window => window.NativeTabs.Where(tab => !window._discardedCloseTabs.Contains(tab.Id)).Select(tab => new DesktopRecoveryTab(
                tab.Id,
                tab.Title,
                tab.DocPath,
                window == activeWindow && tab == window._activeSession)))
            .Where(tab => TabRegistry.All.TryGetValue(tab.Id, out TabSession? session) &&
                (session.HasDocument || session.IsDirty || session.RestoreFromAutosave ||
                 !string.IsNullOrWhiteSpace(session.DocPath)))
            .ToArray();
        DesktopRecoveryStore.SaveTabs(tabs);
    }

    private static string[] FilterAlreadyOpenPaths(
        IEnumerable<string> paths,
        out TabSession? firstExisting)
    {
        firstExisting = null;
        var result = new List<string>();
        foreach (string path in paths.Where(IsReadablePdf).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            TabSession? existing = FindOpenSession(path);
            if (existing is not null)
            {
                firstExisting ??= existing;
                continue;
            }
            result.Add(Path.GetFullPath(path));
        }
        return result.ToArray();
    }

    private static TabSession? FindOpenSession(string path) =>
        TabRegistry.All.Values.FirstOrDefault(tab =>
            PathsEqual(tab.DocPath, path) || PathsEqual(tab.PendingOpenPath, path));

    private static bool PathsEqual(string? left, string? right)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right)) return false;
        try
        {
            return string.Equals(
                Path.GetFullPath(left),
                Path.GetFullPath(right),
                StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static void ActivateExistingSession(TabSession session)
    {
        if (session.Owner is not { } owner) return;
        if (!owner.IsVisible) owner.Show();
        ShellWindowActivation.BringToFront(owner);
        owner.SelectOnlyNativeTab(session);
        owner.ActivateSession(session);
        owner.Activate();
        owner.EnsureNativeTabVisible(session);
    }

    private static bool IsReadablePdf(string path)
    {
        try
        {
            string fullPath = Path.GetFullPath(path);
            return File.Exists(fullPath) &&
                Path.GetExtension(fullPath).Equals(".pdf", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static bool IsTrustedViewUri(string? rawUri)
    {
        return Uri.TryCreate(rawUri, UriKind.Absolute, out Uri? uri) &&
            uri.Scheme == Uri.UriSchemeHttps && uri.IsDefaultPort &&
            string.IsNullOrEmpty(uri.UserInfo) &&
            uri.Host.Equals(LocalAppHost, StringComparison.OrdinalIgnoreCase) &&
            uri.AbsolutePath.Equals("/view.html", StringComparison.OrdinalIgnoreCase);
    }

    private void OnNewWindowRequested(CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        bool isBlank = string.IsNullOrWhiteSpace(e.Uri) ||
            e.Uri.Equals("about:blank", StringComparison.OrdinalIgnoreCase);
        if (e.IsUserInitiated && !isBlank) OpenExternalUri(e.Uri);
    }

    private static void OpenExternalUri(string? rawUri)
    {
        if (!Uri.TryCreate(rawUri, UriKind.Absolute, out Uri? uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch { }
    }

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    private static bool GetBoolean(JsonElement root, string name) =>
        root.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.True;

    private static int GetInt32(JsonElement root, string name) =>
        root.TryGetProperty(name, out JsonElement value) && value.TryGetInt32(out int result) ? result : 0;

    private static long GetInt64(JsonElement root, string name) =>
        root.TryGetProperty(name, out JsonElement value) && value.TryGetInt64(out long result) ? result : 0;

    private static T? FindVisualAncestor<T>(DependencyObject? child) where T : DependencyObject
    {
        while (child is not null)
        {
            if (child is T match) return match;
            try { child = VisualTreeHelper.GetParent(child); }
            catch (InvalidOperationException) { child = LogicalTreeHelper.GetParent(child); }
        }
        return null;
    }

    private static T? FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
    {
        for (int index = 0; index < VisualTreeHelper.GetChildrenCount(parent); index++)
        {
            DependencyObject child = VisualTreeHelper.GetChild(parent, index);
            if (child is T match) return match;
            if (FindVisualChild<T>(child) is { } descendant) return descendant;
        }
        return null;
    }

    internal static void BroadcastUpdateState()
    {
        if (((App)Application.Current).Updates is not { } updates) return;
        foreach (MainWindow window in OpenWindows.Values.ToArray())
            foreach (TabSession tab in window.NativeTabs)
                if (tab.ViewReady) window.SendHostCommand(tab, updates.Snapshot);
    }

    private static void ApplyEditorThemeAcrossWindows(string theme)
    {
        foreach (MainWindow window in OpenWindows.Values.ToArray())
        {
            window.ApplyEditorTheme(theme);
            foreach (TabSession tab in window.NativeTabs)
                window.SendHostCommand(tab, new { cmd = "set-theme", theme });
        }
    }

    private void ApplyEditorTheme(string theme)
    {
        bool light = theme == "light";
        _editorTheme = light ? "light" : "dark";
        SetChromeBrush("ChromeBackgroundBrush", light ? "#E8EAED" : "#1E2227");
        SetChromeBrush("ChromeTabBrush", light ? "#E9ECF0" : "#292E35");
        SetChromeBrush("ChromeSelectedTabBrush", light ? "#DDE7F7" : "#334252");
        SetChromeBrush("ChromeActiveTabBrush", light ? "#F7F8FA" : "#262B31");
        SetChromeBrush("ChromeBorderBrush", light ? "#CDD3DA" : "#3C444E");
        SetChromeBrush("ChromeStrongBorderBrush", light ? "#B8C0C9" : "#59626D");
        SetChromeBrush("ChromeTabSeparatorBrush", light ? "#8F98A3" : "#69737E");
        SetChromeBrush("ChromeTextBrush", light ? "#4F5963" : "#C7CCD3");
        SetChromeBrush("ChromeActiveTextBrush", light ? "#1F2328" : "#FFFFFF");
        SetChromeBrush("ChromeHoverBrush", light ? "#DDE1E6" : "#2D333B");
        SetChromeBrush("ChromePressedBrush", light ? "#CED4DA" : "#4A515B");
        SetChromeBrush("ChromeMenuBrush", light ? "#F7F8FA" : "#292E35");
        SetChromeBrush("ChromeMenuHoverBrush", light ? "#E9ECF0" : "#414852");
        SetChromeBrush("ChromeWindowBorderBrush", light ? "#CDD3DA" : "#111418");
        SetChromeBrush("ChromeAccentBrush", light ? "#2F6FE0" : "#5EA2E8");
        ApplyWindowsTitleBarTheme();
    }

    private void SetChromeBrush(string key, string color) =>
        Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));

    private void ApplyWindowsTitleBarTheme()
    {
        if (Handle == IntPtr.Zero) return;
        int dark = _editorTheme == "dark" ? 1 : 0;
        if (DwmSetWindowAttribute(Handle, DwmUseImmersiveDarkMode, ref dark, sizeof(int)) != 0)
            _ = DwmSetWindowAttribute(Handle, DwmUseImmersiveDarkModeBefore20H1, ref dark, sizeof(int));
        int corner = DwmWindowCornerPreferenceRound;
        _ = DwmSetWindowAttribute(Handle, DwmWindowCornerPreference, ref corner, sizeof(int));
    }

    private void ApplyMinMaxInfo(IntPtr hwnd, IntPtr lParam)
    {
        var info = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        uint dpi = GetDpiForWindow(hwnd);
        int workWidth = 0, workHeight = 0;
        IntPtr monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor != IntPtr.Zero)
        {
            var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
            if (GetMonitorInfo(monitor, ref monitorInfo))
            {
                NativeRect work = monitorInfo.WorkArea;
                NativeRect area = monitorInfo.MonitorArea;
                workWidth = Math.Abs(work.Right - work.Left);
                workHeight = Math.Abs(work.Bottom - work.Top);
                info.MaxPosition.X = Math.Abs(work.Left - area.Left);
                info.MaxPosition.Y = Math.Abs(work.Top - area.Top);
                info.MaxSize.X = workWidth;
                info.MaxSize.Y = workHeight;
            }
        }
        var minimum = WindowSizePolicy.MinimumTrackSize(dpi, workWidth, workHeight);
        info.MinTrackSize.X = minimum.Width;
        info.MinTrackSize.Y = minimum.Height;
        double scale = (dpi == 0 ? 96 : dpi) / 96d;
        if (MinWidth != minimum.Width / scale) MinWidth = minimum.Width / scale;
        if (MinHeight != minimum.Height / scale) MinHeight = minimum.Height / scale;
        Marshal.StructureToPtr(info, lParam, true);
    }

    private static IntPtr MakeLParam(int x, int y) => (IntPtr)((y << 16) | (x & 0xFFFF));

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")]
    private static extern bool ScreenToClient(IntPtr hwnd, ref NativePoint point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(
        uint extendedStyle,
        string className,
        string? windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        IntPtr parent,
        IntPtr menu,
        IntPtr instance,
        IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(
        IntPtr hwnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);
    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect MonitorArea;
        public NativeRect WorkArea;
        public uint Flags;
    }

    private sealed record OutboundBuffer(TabSession Session, CoreWebView2SharedBuffer Buffer);
    private sealed record PendingWrite(
        TabSession Session,
        CoreWebView2SharedBuffer Buffer,
        string SuggestedName,
        bool ForceSaveAs);
}
