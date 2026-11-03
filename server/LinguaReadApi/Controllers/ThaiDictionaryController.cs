using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LinguaReadApi.Services.Tokenization;

namespace LinguaReadApi.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/segmentation/thai-dict-v1/dictionary")]
public class ThaiDictionaryController : ControllerBase
{
    public const string DictionarySha256 = ThaiSegmenter.DictionarySha256;
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

        var stream = typeof(ThaiDictionaryController).Assembly
            .GetManifestResourceStream(ThaiSegmenter.DictionaryResourceName)
            ?? throw new InvalidOperationException("The pinned Thai segmentation dictionary is missing.");
        return File(stream, "text/plain; charset=utf-8");
    }
}
