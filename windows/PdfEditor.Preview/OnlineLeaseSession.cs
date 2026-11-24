using System;
using System.Diagnostics;

namespace PdfEditor.Preview;

internal enum OnlineLeaseAccessMode
{
    Preview,
    Online,
    Reconnecting,
    OfflineGrace,
    SaveOnly
}

internal sealed class WindowsAccessSnapshot
{
    public WindowsAccessSnapshot(
        string mode,
        bool canOpenNewDocuments,
        bool canEditCurrentDocuments,
        bool canSaveCurrentDocuments,
        int? graceRemainingSeconds,
        string message)
    {
        Mode = mode;
        CanOpenNewDocuments = canOpenNewDocuments;
        CanEditCurrentDocuments = canEditCurrentDocuments;
        CanSaveCurrentDocuments = canSaveCurrentDocuments;
        GraceRemainingSeconds = graceRemainingSeconds;
        Message = message;
    }

    public string Mode { get; }
    public bool CanOpenNewDocuments { get; }
    public bool CanEditCurrentDocuments { get; }
    public bool CanSaveCurrentDocuments { get; }
    public int? GraceRemainingSeconds { get; }
    public string Message { get; }
}

internal sealed class OnlineLeaseSession
{
    private readonly bool _previewBypass;
    private readonly TimeSpan _offlineGracePeriod;
    private OnlineLeaseAccessMode _mode;
    private TimeSpan _remainingGrace;
    private long? _activeSinceTimestamp;
    private bool _isForeground;
    private bool _isSuspended;
    private bool _hasValidatedLease;

    public OnlineLeaseSession(bool previewBypass, TimeSpan offlineGracePeriod)
    {
        if (offlineGracePeriod <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(offlineGracePeriod));
        }

        _previewBypass = previewBypass;
        _offlineGracePeriod = offlineGracePeriod;
        _remainingGrace = offlineGracePeriod;
        _mode = previewBypass ? OnlineLeaseAccessMode.Preview : OnlineLeaseAccessMode.SaveOnly;
    }

    public event EventHandler? Changed;

    public WindowsAccessSnapshot Snapshot
    {
        get
        {
            bool canOpen = _mode is OnlineLeaseAccessMode.Preview or OnlineLeaseAccessMode.Online;
            bool canEdit = (_mode is OnlineLeaseAccessMode.Preview or OnlineLeaseAccessMode.Online or
                OnlineLeaseAccessMode.OfflineGrace) ||
                (_mode == OnlineLeaseAccessMode.Reconnecting && _hasValidatedLease && _remainingGrace > TimeSpan.Zero);
            int? seconds = CountsAgainstGrace
                ? Math.Max(0, (int)Math.Ceiling(_remainingGrace.TotalSeconds))
                : null;

            return new WindowsAccessSnapshot(
                ModeName(_mode),
                canOpen,
                canEdit,
                true,
                seconds,
                MessageFor(_mode, seconds));
        }
    }

    public void MarkOnlineLeaseValid()
    {
        if (_previewBypass)
        {
            return;
        }

        long now = Stopwatch.GetTimestamp();
        AccountActiveTime(now);
        _hasValidatedLease = true;
        _remainingGrace = _offlineGracePeriod;
        ChangeMode(OnlineLeaseAccessMode.Online, now);
    }

    public void BeginRevalidation()
    {
        if (_previewBypass)
        {
            return;
        }

        long now = Stopwatch.GetTimestamp();
        AccountActiveTime(now);
        ChangeMode(OnlineLeaseAccessMode.Reconnecting, now);
    }

    public void MarkRevalidationUnavailable()
    {
        if (_previewBypass)
        {
            return;
        }

        long now = Stopwatch.GetTimestamp();
        AccountActiveTime(now);
        ChangeMode(
            _hasValidatedLease && _remainingGrace > TimeSpan.Zero
                ? OnlineLeaseAccessMode.OfflineGrace
                : OnlineLeaseAccessMode.SaveOnly,
            now);
    }

    public void MarkLeaseInvalid()
    {
        if (_previewBypass)
        {
            return;
        }

        long now = Stopwatch.GetTimestamp();
        AccountActiveTime(now);
        _hasValidatedLease = false;
        _remainingGrace = TimeSpan.Zero;
        ChangeMode(OnlineLeaseAccessMode.SaveOnly, now);
    }

    public void SetForeground(bool isForeground)
    {
        long now = Stopwatch.GetTimestamp();
        AccountActiveTime(now);
        _isForeground = isForeground;
        ResetActiveClock(now);
    }

    public void Suspend()
    {
        long now = Stopwatch.GetTimestamp();
        AccountActiveTime(now);
        _isSuspended = true;
        _activeSinceTimestamp = null;
    }

    public void Resume()
    {
        long now = Stopwatch.GetTimestamp();
        _isSuspended = false;
        ResetActiveClock(now);
        if (!_previewBypass)
        {
            AccountActiveTime(now);
            ChangeMode(OnlineLeaseAccessMode.Reconnecting, now);
        }
    }

    public void Tick()
    {
        long now = Stopwatch.GetTimestamp();
        int? before = Snapshot.GraceRemainingSeconds;
        AccountActiveTime(now);
        int? after = Snapshot.GraceRemainingSeconds;
        if (before != after)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private void AccountActiveTime(long now)
    {
        if (!CountsAgainstGrace || _isSuspended || !_isForeground)
        {
            _activeSinceTimestamp = null;
            return;
        }

        if (_activeSinceTimestamp is null)
        {
            _activeSinceTimestamp = now;
            return;
        }

        TimeSpan elapsed = Stopwatch.GetElapsedTime(_activeSinceTimestamp.Value, now);
        _activeSinceTimestamp = now;
        if (elapsed <= TimeSpan.Zero)
        {
            return;
        }

        _remainingGrace = elapsed >= _remainingGrace ? TimeSpan.Zero : _remainingGrace - elapsed;
        if (_remainingGrace == TimeSpan.Zero)
        {
            ChangeMode(OnlineLeaseAccessMode.SaveOnly, now);
        }
    }

    private void ChangeMode(OnlineLeaseAccessMode mode, long now)
    {
        bool changed = _mode != mode;
        _mode = mode;
        ResetActiveClock(now);
        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private void ResetActiveClock(long now)
    {
        _activeSinceTimestamp = CountsAgainstGrace && _isForeground && !_isSuspended
            ? now
            : null;
    }

    private bool CountsAgainstGrace =>
        _mode == OnlineLeaseAccessMode.OfflineGrace ||
        (_mode == OnlineLeaseAccessMode.Reconnecting && _hasValidatedLease);

    private static string ModeName(OnlineLeaseAccessMode mode) => mode switch
    {
        OnlineLeaseAccessMode.Preview => "preview",
        OnlineLeaseAccessMode.Online => "online",
        OnlineLeaseAccessMode.Reconnecting => "reconnecting",
        OnlineLeaseAccessMode.OfflineGrace => "offlineGrace",
        _ => "saveOnly"
    };

    private static string MessageFor(OnlineLeaseAccessMode mode, int? seconds) => mode switch
    {
        OnlineLeaseAccessMode.Reconnecting =>
            $"연결을 다시 확인하고 있습니다. 새 문서 열기·병합은 제한되며 현재 문서는 남은 활성 작업 시간 {Math.Max(1, (int)Math.Ceiling((seconds ?? 0) / 60d))}분 동안 편집할 수 있습니다. 저장은 항상 가능합니다.",
        OnlineLeaseAccessMode.OfflineGrace =>
            $"연결이 끊겼습니다. 새 문서 열기·병합은 제한되며 현재 문서는 남은 활성 작업 시간 {Math.Max(1, (int)Math.Ceiling((seconds ?? 0) / 60d))}분 동안 편집할 수 있습니다. 저장은 항상 가능합니다.",
        OnlineLeaseAccessMode.SaveOnly =>
            "인터넷 연결을 확인할 수 없습니다. 현재 문서는 저장·내보내기·닫기만 할 수 있습니다.",
        _ => string.Empty
    };
}
