using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;

// An isolated executable: it references the real tokenizer but never starts the API,
// connects to a database, or writes learner data. ICU interop is a throwaway probe,
// not a proposed production adapter. Keep candidate engines out of API dependencies.
var cases = JsonDocument.Parse(File.ReadAllText(args.Single()));
var initialWorkingSetBytes = Environment.WorkingSet;
var initialization = Stopwatch.StartNew();
var native = NativeWords.TryCreate();
if (native != null)
{
    var firstCase = cases.RootElement.GetProperty("segmentation")[0];
    native.Segment(firstCase.GetProperty("text").GetString()!, firstCase.GetProperty("code").GetString()!);
}
var coldInitializationMs = initialization.Elapsed.TotalMilliseconds;
Language Config(string code) => new() { Code = code, WordCharacters = Language.DefaultWordCharacters + @"\u200C\u200D" };
object Current(string text, string code)
{
    var result = Tokenizer.Tokenize(text, Config(code));
    return new { result.Processed, words = result.Tokens.Where(t => t.IsWord).ToArray(), keys = Tokenizer.ExtractLookupKeys(text, Config(code)).ToArray() };
}
var identity = cases.RootElement.GetProperty("identity").EnumerateArray().Select(c =>
{
    var code = c.GetProperty("code").GetString()!;
    var forms = c.GetProperty("forms").EnumerateArray().Select(f => f.GetString()!).ToArray();
    return new { id = c.GetProperty("id").GetString(), code, keys = forms.Select(f => Tokenizer.NormalizeKey(f, Config(code))).ToArray(), tokenizations = forms.Select(f => Current(f, code)).ToArray() };
}).ToArray();
var segmentation = cases.RootElement.GetProperty("segmentation").EnumerateArray().Select(c =>
{
    var code = c.GetProperty("code").GetString()!;
    var text = c.GetProperty("text").GetString()!;
    return new { id = c.GetProperty("id").GetString(), code, current = Current(text, code), icu = native?.Segment(text, code) };
}).ToArray();
var timings = new List<object>();
foreach (var code in new[] { "zh", "ja", "th" })
{
    var sample = cases.RootElement.GetProperty("segmentation").EnumerateArray().First(c => c.GetProperty("code").GetString() == code).GetProperty("text").GetString()!;
    foreach (var size in new[] { 10_000, 100_000 })
    {
        var text = string.Concat(Enumerable.Repeat(sample, size / sample.Length + 1))[..size];
        var timer = Stopwatch.StartNew();
        var current = Tokenizer.Tokenize(text, Config(code));
        var currentMs = timer.Elapsed.TotalMilliseconds;
        timer.Restart();
        var icu = native?.Segment(text, code);
        timings.Add(new { code, utf16Length = size, currentMs, icuMs = native == null ? (double?)null : timer.Elapsed.TotalMilliseconds, currentWords = current.Tokens.Count(t => t.IsWord), icuWords = icu?.Count(t => t.IsWord) });
    }
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, os = RuntimeInformation.OSDescription, nativeIcu = native?.Library, icuVersion = native?.Version, initialWorkingSetBytes, coldInitializationMs, identity, segmentation, timings, workingSetBytes = Environment.WorkingSet }, new JsonSerializerOptions { WriteIndented = true }));

sealed class NativeWords
{
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr Open(int type, [MarshalAs(UnmanagedType.LPStr)] string locale, IntPtr text, int length, ref int error);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Move(IntPtr iterator);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void Close(IntPtr iterator);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void GetVersion(IntPtr version);
    private readonly Open open;
    private readonly Move first, next, status;
    private readonly Close close;
    public string Library { get; }
    public string Version { get; }
    private NativeWords(IntPtr library, string name, string suffix)
    {
        Library = name + " / exports " + suffix;
        T Function<T>(string function) where T : Delegate => Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, function + suffix));
        open = Function<Open>("ubrk_open"); first = Function<Move>("ubrk_first"); next = Function<Move>("ubrk_next");
        status = Function<Move>("ubrk_getRuleStatus"); close = Function<Close>("ubrk_close");
        var version = Marshal.AllocHGlobal(4);
        try
        {
            Function<GetVersion>("u_getVersion")(version);
            Version = string.Join('.', Enumerable.Range(0, 4).Select(i => Marshal.ReadByte(version, i)));
        }
        finally { Marshal.FreeHGlobal(version); }
    }
    public static NativeWords? TryCreate()
    {
        var names = OperatingSystem.IsLinux()
            ? Directory.EnumerateFiles("/usr/lib/x86_64-linux-gnu", "libicuuc.so.*").ToArray()
            : new[] { "icu.dll" };
        foreach (var name in names)
        {
            if (!NativeLibrary.TryLoad(name, out var library)) continue;
            foreach (var suffix in new[] { "" }.Concat(Enumerable.Range(60, 40).Select(v => "_" + v)))
                if (NativeLibrary.TryGetExport(library, "ubrk_open" + suffix, out _)) return new NativeWords(library, name, suffix);
            NativeLibrary.Free(library);
        }
        return null;
    }
    public sealed record Span(string Text, int Start, int End, bool IsWord);
    public List<Span> Segment(string text, string locale)
    {
        var buffer = Marshal.StringToHGlobalUni(text);
        IntPtr iterator = IntPtr.Zero;
        try
        {
            int error = 0;
            iterator = open(1, locale, buffer, text.Length, ref error);
            if (error > 0 || iterator == IntPtr.Zero) throw new InvalidOperationException("ICU error " + error);
            var result = new List<Span>();
            var start = first(iterator);
            for (var end = next(iterator); end != -1; start = end, end = next(iterator))
                result.Add(new(text[start..end], start, end, status(iterator) >= 100));
            if (string.Concat(result.Select(s => s.Text)) != text || result.Any(s => text[s.Start..s.End] != s.Text))
                throw new InvalidOperationException("ICU lost text or returned invalid UTF-16 spans");
            return result;
        }
        finally
        {
            if (iterator != IntPtr.Zero) close(iterator);
            Marshal.FreeHGlobal(buffer);
        }
    }
}
