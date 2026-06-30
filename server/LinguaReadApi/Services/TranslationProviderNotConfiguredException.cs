using System;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Thrown by a word-translation provider when neither a per-user credential nor a server-level
    /// fallback is configured, so there is nothing to authenticate with. The controller maps this
    /// to a clear 4xx ("provider not configured") instead of silently returning empty translations,
    /// which in the reader is indistinguishable from "the provider produced no result".
    /// </summary>
    public class TranslationProviderNotConfiguredException : Exception
    {
        public TranslationProviderNotConfiguredException(string providerName)
            : base($"{providerName} is not configured. Add an API key in Settings (or configure a server-level key).")
        {
            ProviderName = providerName;
        }

        public string ProviderName { get; }
    }
}
