using System.Threading.Tasks;

namespace LinguaReadApi.Services
{
    public interface ISentenceTranslationService
    {
        Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage);
        Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage);
        Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage);
        Task<string> TranslateSelectionWithContextAsync(string selectedText, string sentenceContext, string sourceLanguage, string targetLanguage);
    }
}
