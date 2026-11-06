using LinguaReadApi.Controllers;
using Xunit;

namespace LinguaReadApi.Tests;

public class SrtTranscriptTests
{
    [Fact]
    public void Transcript_PreservesNumericDialogue_AndCueLineBreaks()
    {
        const string srt = "1\r\n00:00:05,5 --> 00:00:06,50\r\n1984\r\n42\r\n\r\n2\r\n00:00:07,000 --> 00:00:08,000\r\n中文第一行\r\n第二行。";
        Assert.Equal("1984\n42\n中文第一行\n第二行。", TextsController.ParseSrt(srt));
    }
}
