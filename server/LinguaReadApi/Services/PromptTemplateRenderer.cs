using System.Collections.Generic;
using System.Text;

namespace LinguaReadApi.Services
{
    public static class PromptTemplateRenderer
    {
        public static string Render(string template, IReadOnlyDictionary<string, string?> vars)
        {
            if (string.IsNullOrEmpty(template))
            {
                return template ?? string.Empty;
            }

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
                    }
                }
                sb.Append(c);
                i++;
            }

            return sb.ToString();
        }
    }
}
