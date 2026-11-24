using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using PdfEditor.Preview;

internal static class PrintResourceProbe
{
    public static int Run()
    {
        var read = typeof(MainWindow).GetMethod("GetPrintMemory", BindingFlags.Static | BindingFlags.NonPublic)!;
        Console.WriteLine("ready");
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            var ids = request.RootElement.GetProperty("ids").EnumerateArray().Select(x => x.GetInt32());
            var processes = new List<object>();
            foreach (int id in ids)
            {
                try
                {
                    using var process = Process.GetProcessById(id);
                    processes.Add(new { id, workingSetBytes = process.WorkingSet64,
                        privateBytes = process.PrivateMemorySize64, cpuSeconds = process.TotalProcessorTime.TotalSeconds });
                }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
            }
            Console.WriteLine(JsonSerializer.Serialize(new { memory = read.Invoke(null, null), processes }));
        }
        return 0;
    }
}
