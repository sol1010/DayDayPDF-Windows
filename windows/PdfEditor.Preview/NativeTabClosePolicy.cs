namespace PdfEditor.Preview;

internal static class NativeTabClosePolicy
{
    internal static T[] Select<T>(IReadOnlyList<T> tabs, T target, string command, Func<T, bool> selected)
    {
        int index = -1;
        for (int i = 0; i < tabs.Count; i++)
            if (EqualityComparer<T>.Default.Equals(tabs[i], target)) { index = i; break; }
        if (index < 0) return [];
        return tabs.Where((tab, i) => command switch
        {
            "close" => i == index,
            "selected" => selected(tab),
            "others" => i != index,
            "left" => i < index,
            "right" => i > index,
            "all" => true,
            _ => false
        }).ToArray();
    }
}
