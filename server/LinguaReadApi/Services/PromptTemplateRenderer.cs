using System.Collections.Generic;
using System.Text;

namespace LinguaReadApi.Services
{
    public static class PromptTemplateRenderer
    {
        public static string Render(string template, IReadOnlyDictionary<string, string?> vars)
        {
            return Render(template, vars, out _);
        }

        public static string Render(
            string template,
            IReadOnlyDictionary<string, string?> vars,
            out IReadOnlyList<string> unknownPlaceholders)
        {
            if (string.IsNullOrEmpty(template))
            {
                unknownPlaceholders = System.Array.Empty<string>();
                return template ?? string.Empty;
            }

            HashSet<string>? unknown = null;
            var sb = new StringBuilder(template.Length);
            int i = 0;
            while (i < template.Length)
            {
                char c = template[i];
                if (c == '{')
                {
                    int end = template.IndexOf('}', i + 1);
                    if (end > i + 1)
                    {
                        var key = template.Substring(i + 1, end - i - 1);
                        if (vars.TryGetValue(key, out var value))
                        {
                            sb.Append(value ?? string.Empty);
                            i = end + 1;
                            continue;
                        }

                        // {key} looks like a placeholder but isn't one we know about.
                        // Heuristic: keys that are non-empty and contain no whitespace.
                        if (key.Length > 0 && key.IndexOfAny(new[] { ' ', '\t', '\n', '\r' }) < 0)
                        {
                            (unknown ??= new HashSet<string>(System.StringComparer.Ordinal)).Add(key);
                        }
                    }
                }
                sb.Append(c);
                i++;
            }

            unknownPlaceholders = unknown is null
                ? (IReadOnlyList<string>)System.Array.Empty<string>()
                : new List<string>(unknown);
            return sb.ToString();
        }
    }
}
