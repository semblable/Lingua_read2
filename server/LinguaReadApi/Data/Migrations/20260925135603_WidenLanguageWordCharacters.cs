using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// Widens <c>Languages.WordCharacters</c> values that still hold a shipped default, so
    /// existing installs tokenize European text like new ones:
    /// <list type="bullet">
    /// <item>The Latin seeds become <c>Language.LatinWordCharacters</c>. English, Spanish, French
    /// and German shared one that stopped at U+0233; Italian and Portuguese had short hand-picked
    /// lists that split "Peña", "crème" and "Müller". German keeps its ZWNJ/ZWJ suffix.</item>
    /// <item>"a-zA-Z", the old add-language form default that split every accented letter,
    /// becomes <c>Language.DefaultWordCharacters</c>, for space-delimited languages only. The
    /// tokenizer has no MeCab or Jieba segmenter yet, so for a Japanese or Chinese language
    /// "any letter" would make every unspaced run of text one word; those keep "a-zA-Z".</item>
    /// <item>Russian's "\p{L}\p{M}'-" becomes <c>Language.DefaultWordCharacters</c>. With the
    /// apostrophe and hyphen in the class a lone "-" or "'" was a word; the connector rule
    /// already glues them between letters (кое-что).</item>
    /// </list>
    /// Only exact matches change: a value the user edited is left alone. The literals are frozen
    /// here instead of read from <c>Language</c> so later edits to those constants can't change
    /// what this migration did. The texts are re-linked by <c>WordLinkingMigrationService</c>
    /// (tokenizer version 3), not here.
    ///
    /// Down is deliberately a no-op: the previous tokenizer accepts every new value, and restoring
    /// the old values would bring the splits back.
    /// </summary>
    public partial class WidenLanguageWordCharacters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE ""Languages"" SET ""WordCharacters"" = 'a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}'
                    WHERE ""WordCharacters"" IN ('a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ', 'a-zA-ZÀàÉéÈèÌìÎîÓóÒòÙù', 'a-zA-ZÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü');
                UPDATE ""Languages"" SET ""WordCharacters"" = 'a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}\u200C\u200D'
                    WHERE ""WordCharacters"" = 'a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ\u200C\u200D';
                UPDATE ""Languages"" SET ""WordCharacters"" = '\p{L}\p{M}'
                    WHERE ""WordCharacters"" = 'a-zA-Z' AND ""ParserType"" = 'spacedel';
                UPDATE ""Languages"" SET ""WordCharacters"" = '\p{L}\p{M}'
                    WHERE ""WordCharacters"" = '\p{L}\p{M}''-';
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
