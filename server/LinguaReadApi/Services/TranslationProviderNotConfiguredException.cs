using System;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Thrown when the selected translation or AI provider is missing settings needed for a request.
    /// Controllers return the setup message to the user.
    /// </summary>
    public class TranslationProviderNotConfiguredException : Exception
    {
        public TranslationProviderNotConfiguredException(string providerName)
            : base($"{providerName} is not configured. Add an API key in Settings (or configure a server-level key).")
        {
            ProviderName = providerName;
        }

        public string ProviderName { get; }

        public TranslationProviderNotConfiguredException(string providerName, string message) : base(message)
        {
            ProviderName = providerName;
        }
    }
}
