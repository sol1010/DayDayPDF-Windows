using System.IO;
using System.Reflection;
using DaydayPDF.Printing;
using PdfEditor.Preview;

internal static class TemporaryPrintChecks
{
    public static void Run()
    {
        var paths = new List<string>();
        string NewPrint(string name = "테스트 문서.pdf")
        {
            string path = PrintInbox.NewPath(name);
            paths.Add(path);
            File.WriteAllText(path, "%PDF-1.7\n%%EOF");
            return path;
        }
        static void Check(bool value, string message)
        { if (!value) throw new Exception(message); }
        static void Set(TabSession tab, string property, object? value) =>
            typeof(TabSession).GetProperty(property)!.SetValue(tab, value);
        static void Call(TabSession tab, string method) => typeof(TabSession)
            .GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(tab, null);
        string? savedPath = null;
        try
        {
            string path = NewPrint();
            Check(Path.GetFullPath(PrintInbox.Root).StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase), "Print output must be temporary");
            Check(PrintInbox.Contains(path) && PrintInbox.DisplayName(path) == "테스트 문서.pdf", "Print ownership/name is incorrect");
            Check(!PrintInbox.Contains(Path.Combine(PrintInbox.LegacyRoot, Path.GetFileName(path))), "Legacy prints must stay permanent");
            Check(!PrintInbox.TryDelete(Path.Combine(PrintInbox.LegacyRoot, Path.GetFileName(path))), "Legacy cleanup must be refused");
            Check(!PrintInbox.Contains(Path.Combine(PrintInbox.Root, "regular.pdf")), "Ordinary filenames are not owned prints");
            Check(!PrintInbox.Contains(Path.Combine(PrintInbox.Root, "sub", Path.GetFileName(path))), "Nested paths are not owned prints");
            Check(!PrintInbox.Contains(Path.Combine(PrintInbox.Root, "..", Path.GetFileName(path))), "Traversal must not be classified as owned");
            Check(!PrintInbox.Contains(path + ".partial"), "Partial receiver jobs must not be adopted");
            var tab = new TabSession("테스트 문서", path);
            Check(tab.IsTemporaryPrint && tab.IsDirty, "A newly printed tab must have a red unsaved indicator");
            Set(tab, nameof(TabSession.IsDirty), false);
            Check(tab.IsDirty, "Clean JS state must not remove the unsaved print indicator");
            Check(tab.TabToolTip.Contains("미저장 인쇄 문서") && !tab.TabToolTip.Contains(Path.GetFileName(path)), "Tooltip must describe the temporary document");
            Call(tab, "CloseController");
            Check(File.Exists(path) && tab.IsDirty, "Controller unload/movement must not discard the print");
            var recovered = new TabSession("복구", path, tab.Id);
            Check(recovered.IsTemporaryPrint && recovered.IsDirty, "Recovery must preserve the unsaved print state");
            using (var locked = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                Check(!PrintInbox.TryDelete(path), "A locked file must report cleanup failure");
            Check(File.Exists(path) && tab.IsDirty, "Failed cleanup must not damage the original");
            savedPath = Path.Combine(Path.GetTempPath(), "dayday-saved-test-" + Guid.NewGuid().ToString("N") + ".pdf");
            File.Copy(path, savedPath);
            Set(tab, nameof(TabSession.DocPath), savedPath);
            Call(tab, "ReleaseTemporaryPrint");
            Check(!File.Exists(path) && File.Exists(savedPath) && !tab.IsTemporaryPrint && !tab.IsDirty, "Saving must retain the chosen PDF and release only the temporary file");
            Call(tab, "ReleaseTemporaryPrint");
            Check(File.Exists(savedPath), "Closing a saved tab must never delete the saved PDF");
            Check(!PrintInbox.TryDelete(savedPath), "Cleanup must refuse unrelated PDFs");
            string discarded = NewPrint("discard.pdf");
            var discardTab = new TabSession("discard", discarded);
            var registry = typeof(TabSession).Assembly.GetType("PdfEditor.Preview.TabRegistry")!;
            registry.GetMethod("Close")!.Invoke(null, new object[] { discardTab, true });
            Check(!File.Exists(discarded), "Closing an unsaved print tab must delete its temporary file");
            string failedOpen = NewPrint("failed-open.pdf");
            registry.GetMethod("Close")!.Invoke(null, new object[] { new TabSession("failed", failedOpen), false });
            Check(File.Exists(failedOpen), "Failed tab creation must preserve the received print for recovery");
            Console.WriteLine("Temporary prints: temp path, friendly name, unsaved state, recovery, unload, save, close, and cleanup boundaries passed");
        }
        finally
        {
            foreach (string path in paths) PrintInbox.TryDelete(path);
            if (savedPath is not null) File.Delete(savedPath);
        }
    }
}
