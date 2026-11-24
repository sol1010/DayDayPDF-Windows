using System.Windows;

namespace PdfEditor.Preview;

public partial class App : Application
{
    private SingleInstanceCoordinator? _singleInstance;

    internal DesktopUpdates? Updates { get; private set; }
    private bool _sessionEnding;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        LaunchRequest request = LaunchRequest.Parse(e.Args);
        _singleInstance = new SingleInstanceCoordinator();

        if (!_singleInstance.TryBecomePrimary(request))
        {
            Shutdown();
            return;
        }

        IReadOnlyList<DesktopRecoveryTab> recoveryTabs =
            request.Files.Length == 0 && !request.Action.Equals("merge", StringComparison.OrdinalIgnoreCase)
                ? DesktopRecoveryStore.LoadTabs()
                : Array.Empty<DesktopRecoveryTab>();
        bool needsHostTab = recoveryTabs.Count == 0 &&
            (request.Files.Length != 1 || request.Action.Equals("merge", StringComparison.OrdinalIgnoreCase));
        var window = new MainWindow(createInitialTab: needsHostTab, recoveryTabs: recoveryTabs);
        MainWindow = window;
        _singleInstance.RequestReceived += incoming => Dispatcher.Invoke(() =>
        {
            var target = PdfEditor.Preview.MainWindow.GetPreferredLaunchWindow(incoming) ?? window;
            target.EnqueueLaunchRequest(incoming);
        });

        Updates = new DesktopUpdates();
        Updates.Changed += PdfEditor.Preview.MainWindow.BroadcastUpdateState;
        window.Show();
        Updates.Start();
        window.EnqueueLaunchRequest(request);
    }

    protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
    {
        base.OnSessionEnding(e);
        _sessionEnding = !e.Cancel;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Updates?.Exit(e.ApplicationExitCode == 0 && !_sessionEnding);
        _singleInstance?.Dispose();
        PdfEditor.Preview.MainWindow.ShutdownControllerParkingHost();
        base.OnExit(e);
    }
}

