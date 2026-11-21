using System.IO;

namespace LinguaReadApi.Utilities
{
    public static class UploadFileName
    {
        /// <summary>
        /// The final name segment of a client-supplied upload name. Some clients send a Windows
        /// path (C:\fakepath\book.epub), and on Linux Path.GetFileName treats '\' as an ordinary
        /// character, so normalize separators first.
        /// </summary>
        public static string Get(string? fileName) =>
            Path.GetFileName((fileName ?? string.Empty).Replace('\\', '/'));
    }
}
