using System.Threading.Tasks;

namespace LinguaReadApi.Services
{
    public interface ISummarizationService
    {
        Task<string> SummarizeAsync(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords = 200);
    }
}
