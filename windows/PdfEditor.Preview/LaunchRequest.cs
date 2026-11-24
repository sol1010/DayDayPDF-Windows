using System.IO;

namespace PdfEditor.Preview;

public sealed record LaunchRequest(string Action, string[] Files)
{
    internal IntPtr ActivationWindow { get; set; }

    public static LaunchRequest Parse(IEnumerable<string> arguments)
    {
        string action = "open";
        var files = new List<string>();

        foreach (string rawArgument in arguments)
        {
            string argument = rawArgument.Trim();
            if (argument.Equals("--merge", StringComparison.OrdinalIgnoreCase))
            {
                action = "merge";
                continue;
            }

            if (argument.Equals("--open", StringComparison.OrdinalIgnoreCase))
            {
                action = "open";
                continue;
            }

            try
            {
                string fullPath = Path.GetFullPath(argument.Trim('"'));
                if (File.Exists(fullPath) &&
                    Path.GetExtension(fullPath).Equals(".pdf", StringComparison.OrdinalIgnoreCase))
                {
                    files.Add(fullPath);
                }
            }
            catch (Exception)
            {
            }
        }

        return new LaunchRequest(
            action,
            files.Distinct(StringComparer.OrdinalIgnoreCase).ToArray());
    }
}
