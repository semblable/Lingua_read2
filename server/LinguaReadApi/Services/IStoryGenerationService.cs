using System.Threading.Tasks;

namespace LinguaReadApi.Services
{
    public interface IStoryGenerationService
    {
        Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens = 20000);
    }
}
