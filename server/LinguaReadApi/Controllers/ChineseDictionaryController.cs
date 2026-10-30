using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LinguaReadApi.Services.Tokenization;

namespace LinguaReadApi.Controllers;

// The reader uses the same immutable bytes as the server segmenter. A new
// dictionary requires a new profile and URL, never replacing jieba-v1 in place.
[ApiController]
[AllowAnonymous]
[Route("api/segmentation/jieba-v1/dictionary")]
public class ChineseDictionaryController : ControllerBase
{
    public const string DictionarySha256 = ChineseSegmenter.DictionarySha256;
    private const string ETagValue = "\"" + DictionarySha256 + "\"";

    [HttpGet]
    public IActionResult GetDictionary()
    {
        Response.Headers.ETag = ETagValue;
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        if (Request.Headers.IfNoneMatch.ToString().Split(',').Any(value =>
            value.Trim() is "*" || value.Trim() == ETagValue || value.Trim() == "W/" + ETagValue))
        {
            return StatusCode(StatusCodes.Status304NotModified);
        }

        var stream = typeof(ChineseDictionaryController).Assembly
            .GetManifestResourceStream(ChineseSegmenter.DictionaryResourceName)
            ?? throw new InvalidOperationException("The pinned Chinese segmentation dictionary is missing.");
        return File(stream, "text/plain; charset=utf-8");
    }
}
