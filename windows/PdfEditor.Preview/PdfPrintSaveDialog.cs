using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace PdfEditor.Preview;

internal static class PdfPrintSaveDialog
{
    internal sealed record Selection(string Path, bool OpenInDaydayPdf);
    private const uint OpenControl = 1001;
    private static readonly Guid DialogClass = new("C0B4E2F3-BA21-4773-8DBA-335EC946EB8B");

    internal static Selection? Show(Window owner, string name)
    {
        var instance = Create(name);
        try
        {
            var dialog = (IFileDialog)instance;
            var customize = (IFileDialogCustomize)instance;
            int result = dialog.Show(new WindowInteropHelper(owner).Handle);
            if (result == unchecked((int)0x800704C7)) return null;
            Marshal.ThrowExceptionForHR(result);
            customize.GetCheckButtonState(OpenControl, out bool open);
            dialog.GetResult(out IShellItem item);
            try
            {
                item.GetDisplayName(0x80058000, out string path); // SIGDN_FILESYSPATH
                return new Selection(path, open);
            }
            finally { Marshal.FinalReleaseComObject(item); }
        }
        finally { Marshal.FinalReleaseComObject(instance); }
    }

    private static object Create(string name)
    {
        var instance = Activator.CreateInstance(Type.GetTypeFromCLSID(DialogClass)!)!;
        try
        {
            var dialog = (IFileDialog)instance;
            dialog.GetOptions(out uint options);
            dialog.SetOptions(options | 0x2 | 0x4 | 0x8 | 0x40 | 0x800);
            dialog.SetFileTypes(1, new[] { new Filter { Name = "PDF 문서", Pattern = "*.pdf" } });
            dialog.SetDefaultExtension("pdf"); dialog.SetFileName(name);
            dialog.SetTitle("PDF로 인쇄 — 저장"); dialog.SetOkButtonLabel("저장");
            ((IFileDialogCustomize)instance).AddCheckButton(OpenControl, "저장 후 DaydayPDF로 열기", true);
            return instance;
        }
        catch { Marshal.FinalReleaseComObject(instance); throw; }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Filter
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string Name;
        [MarshalAs(UnmanagedType.LPWStr)] public string Pattern;
    }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] Filter[] filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem item);
        void SetFolder(IShellItem item);
        void GetFolder(out IShellItem item);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, uint alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
    }

    [ComImport, Guid("E6FDD21A-163F-4975-9C8C-A69F1BA37034"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialogCustomize
    {
        void EnableOpenDropDown(uint id);
        void AddMenu(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label);
        void AddPushButton(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label);
        void AddComboBox(uint id);
        void AddRadioButtonList(uint id);
        void AddCheckButton(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label, [MarshalAs(UnmanagedType.Bool)] bool check);
        void AddEditBox(uint id, [MarshalAs(UnmanagedType.LPWStr)] string text);
        void AddSeparator(uint id);
        void AddText(uint id, [MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetControlLabel(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetControlState(uint id, out uint state);
        void SetControlState(uint id, uint state);
        void GetEditBoxText(uint id, [MarshalAs(UnmanagedType.LPWStr)] out string text);
        void SetEditBoxText(uint id, [MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetCheckButtonState(uint id, [MarshalAs(UnmanagedType.Bool)] out bool check);
        void SetCheckButtonState(uint id, [MarshalAs(UnmanagedType.Bool)] bool check);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    }
}
