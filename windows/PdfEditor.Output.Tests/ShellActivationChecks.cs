using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using PdfEditor.Preview;

internal static class ShellActivationChecks
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(uint process);

    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);

    private static bool IsAbove(IntPtr front, IntPtr back)
    {
        var seen = new HashSet<IntPtr>();
        for (IntPtr h = GetWindow(back, 3); h != IntPtr.Zero && seen.Add(h); h = GetWindow(h, 3))
            if (h == front) return true;
        return false;
    }

    private static Window ProbeWindow() => new() { Title="DaydayPDF activation probe", Width=120, Height=80,
        Left=-20000, Top=-20000, ShowInTaskbar=false, ShowActivated=false, Opacity=0,
        WindowStyle=WindowStyle.None };

    internal static int Run(string[] args)
    {
        var original = GetForegroundWindow();
        var app = new Application { ShutdownMode=ShutdownMode.OnExplicitShutdown };
        int result=1;
        app.Startup += async (_, _) => {
            try {
                if (args is ["--shell-activation-target", var pipeName, var state, var parent]) {
                    using var pipe = new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,
                        PipeTransmissionMode.Byte,PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    var target=ProbeWindow(); target.Show();
                    if (state=="minimized") target.WindowState=WindowState.Minimized;
                    if (state=="maximized-minimized") { target.WindowState=WindowState.Maximized; target.WindowState=WindowState.Minimized; }
                    using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(15));
                    await pipe.WaitForConnectionAsync(deadline.Token);
                    using var reader=new StreamReader(pipe);
                    using var writer=new StreamWriter(pipe) {AutoFlush=true};
                    await writer.WriteLineAsync(new WindowInteropHelper(target).Handle.ToInt64().ToString());
                    if (await reader.ReadLineAsync(deadline.Token)!="open") throw new Exception("Missing launch request");
                    bool fromLauncher=state=="launcher";
                    bool activated=fromLauncher || ShellWindowActivation.BringToFront(target);
                    if (fromLauncher && await reader.ReadLineAsync(deadline.Token)!="activated") throw new Exception("Missing foreground handoff");
                    await Task.Delay(100);
                    bool foreground=GetForegroundWindow()==new WindowInteropHelper(target).Handle;
                    await writer.WriteLineAsync($"{activated},{foreground},{target.WindowState},{target.Topmost}");
                    await reader.ReadLineAsync(deadline.Token);
                    AllowSetForegroundWindow(uint.Parse(parent));
                    target.Close();
                } else {
                    var launcher=ProbeWindow(); launcher.Show();
                    var verified=new HashSet<string>();
                    foreach (string caseState in new[]{"normal","minimized","maximized-minimized","launcher"}) {
                        string casePipeName="DaydayPDF.Activation.Test."+Guid.NewGuid().ToString("N");
                        var start=new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory,"PdfEditor.Output.Tests.exe")) {
                            UseShellExecute=false, CreateNoWindow=true, WindowStyle=ProcessWindowStyle.Hidden };
                        foreach (string arg in new[]{"--shell-activation-target",casePipeName,caseState,Environment.ProcessId.ToString()}) start.ArgumentList.Add(arg);
                        using var child=Process.Start(start) ?? throw new Exception("Probe launch failed");
                        try {
                            using var pipe=new NamedPipeClientStream(".",casePipeName,PipeDirection.InOut,PipeOptions.Asynchronous);
                            await pipe.ConnectAsync(10000);
                            using var reader=new StreamReader(pipe);
                            using var writer=new StreamWriter(pipe) {AutoFlush=true};
                            if (!long.TryParse(await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)), out long targetHandle))
                                throw new Exception("Probe not ready");
                            var target = new IntPtr(targetHandle);
                            var cover = new WindowInteropHelper(launcher).Handle;
                            SetWindowPos(target, new IntPtr(1), 0, 0, 0, 0, 0x13);
                            if (IsAbove(target, cover)) throw new Exception("Editor did not start behind the covering window");
                            launcher.Activate(); SetForegroundWindow(new WindowInteropHelper(launcher).Handle);
                            await Task.Delay(50);
                            bool eligible=GetForegroundWindow()==new WindowInteropHelper(launcher).Handle;
                            bool granted=ShellWindowActivation.GrantToPipeServer(pipe.SafePipeHandle, out uint serverId);
                            if (eligible && !granted) throw new Exception("Foreground handoff failed");
                            if (ShellWindowActivation.ActivateFromLauncher(serverId, new WindowInteropHelper(launcher).Handle))
                                throw new Exception("Accepted a window outside the pipe server");
                            await writer.WriteLineAsync("open");
                            if (caseState=="launcher")
                            {
                                bool raised=ShellWindowActivation.ActivateFromLauncher(serverId,new IntPtr(targetHandle));
                                if (eligible && !raised) throw new Exception("Launcher did not activate the editor window");
                                await writer.WriteLineAsync("activated");
                            }
                            string? actual=await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10));
                            string expected=caseState=="maximized-minimized" ? "True,True,Maximized,False" : "True,True,Normal,False";
                            if (eligible && actual==expected) verified.Add(caseState);
                            if (eligible && actual!=expected) throw new Exception($"{caseState}: {actual}, expected {expected}");
                            if (!eligible && (actual is null || !actual.EndsWith(expected[9..],StringComparison.Ordinal)))
                                throw new Exception($"{caseState}: restore failed: {actual}");
                            if (caseState!="launcher" || eligible)
                            {
                                if (!IsAbove(target,cover) || (GetWindowLong(target,-20) & 8)!=0)
                                    throw new Exception("Editor must be above the covering window at normal Z order: "+caseState);
                                Console.WriteLine("PASS "+caseState+": editor moved from behind to in front of covering window");
                            }
                            await writer.WriteLineAsync("done");
                            await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
                            if (child.ExitCode!=0) throw new Exception("Target failed");
                            Console.WriteLine(eligible ? $"PASS {caseState}: separate-process permission transfer, foreground, restore, not topmost" : $"PASS {caseState}: restore and not topmost; SKIP foreground assertion (automation has no foreground eligibility), handoff={granted}, actual={actual}");
                        } finally { if (!child.HasExited) child.Kill(entireProcessTree:true); }
                    }
                    Console.WriteLine("Foreground modes verified: "+string.Join(", ",verified.Order()));
                    if (verified.Count!=4) Console.WriteLine("LIMITATION: this automation session could not verify foreground eligibility in all modes.");
                    launcher.Close();
                }
                result=0;
            } catch(Exception error) {Console.Error.WriteLine(error);}
            finally { if (args.Length==1) SetForegroundWindow(original); app.Shutdown(); }
        };
        app.Run(); return result;
    }
}
