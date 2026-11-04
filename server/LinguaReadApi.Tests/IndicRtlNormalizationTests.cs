using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Xunit;

namespace LinguaReadApi.Tests;

public class IndicRtlNormalizationTests
{
    private static Language CreateLang(string code, string wordChars = @"\p{L}\p{M}\u200C\u200D", string subs = "") => new()
    {
        Code = code,
        Name = code,
        WordCharacters = wordChars,
        CharacterSubstitutions = subs,
        SplitSentences = ".!?",
        ParserType = "spacedel"
    };

    private static readonly Language Hi = CreateLang("hi", @"\p{L}\p{M}\u200C\u200D");
    private static readonly Language Bn = CreateLang("bn", @"\p{L}\p{M}\u200C\u200D");
    private static readonly Language Ta = CreateLang("ta", @"\p{L}\p{M}\u200C\u200D");
    private static readonly Language Ar = CreateLang("ar", @"\p{L}\p{M}");
    private static readonly Language ArWithDigits = CreateLang("ar", @"\p{L}\p{M}\p{N}");
    private static readonly Language Fa = CreateLang("fa", @"\p{L}\p{M}\u200C\u200D");
    private static readonly Language He = CreateLang("he", @"\p{L}\p{M}");
    private static readonly Language HeWithDigits = CreateLang("he", @"\p{L}\p{M}\p{N}");
    private static readonly Language Ur = CreateLang("ur", @"\p{L}\p{M}\u200C\u200D");
    private static readonly Language Ru = CreateLang("ru", @"\p{L}\p{M}");
    private static readonly Language Uk = CreateLang("uk", @"\p{L}\p{M}");
    private static readonly Language Lt = CreateLang("lt", @"\p{L}\p{M}");

    private static string[] WordsOf(string content, Language lang) =>
        Tokenizer.Tokenize(content, lang).Tokens.Where(t => t.IsWord).Select(t => t.Text).ToArray();

    private static string[] LookupKeysOf(string content, Language lang) =>
        Tokenizer.ExtractLookupKeys(content, lang).ToArray();

    // -------------------------------------------------------------
    // Indic Scripts: Hindi, Bengali, Tamil
    // -------------------------------------------------------------

    [Fact]
    public void Hindi_01_PreservesNuktaAndVirama_ExcludesPurnaViram()
    {
        const string input = "ग़ज़ल में ख़ास लफ़्ज़ हैं।";
        var words = WordsOf(input, Hi);
        Assert.Equal(new[] { "ग़ज़ल", "में", "ख़ास", "लफ़्ज़", "हैं" }, words);
    }

    [Fact]
    public void Hindi_02_PreservesZWNJ_TrailingHalant_ExcludesDoubleDanda()
    {
        const string input = "श्रीमान् ने क्\u200Cष और क्ष का अंतर बताया॥";
        var words = WordsOf(input, Hi);
        Assert.Equal(new[] { "श्रीमान्", "ने", "क्\u200Cष", "और", "क्ष", "का", "अंतर", "बताया" }, words);
        Assert.Contains('\u200C', words[2]);
    }

    [Fact]
    public void Bengali_01_PreservesZWJ_And_ZWNJ()
    {
        const string input = "র\u200D্যাব ও র\u200C্যাব কি এক?";
        var words = WordsOf(input, Bn);
        Assert.Equal(new[] { "র\u200D্যাব", "ও", "র\u200C্যাব", "কি", "এক" }, words);
        Assert.Contains('\u200D', words[0]);
        Assert.Contains('\u200C', words[2]);
    }

    [Fact]
    public void Bengali_02_PreservesNukta_ExcludesDari()
    {
        const string input = "আষাঢ় মাসে প্রচুর বৃষ্টি হয়।";
        var words = WordsOf(input, Bn);
        Assert.Equal(new[] { "আষাঢ়", "মাসে", "প্রচুর", "বৃষ্টি", "হয়" }, words);
    }

    [Fact]
    public void Tamil_01_PreservesAythamAndPulli()
    {
        const string input = "அஃது தமிழ் மொழியின் சிறப்பு!";
        var words = WordsOf(input, Ta);
        Assert.Equal(new[] { "அஃது", "தமிழ்", "மொழியின்", "சிறப்பு" }, words);
    }

    [Fact]
    public void Tamil_02_PreservesGranthaLigatures()
    {
        const string input = "க்ஷத்ரியர் மற்றும் ஸ்ரீநிவாசன் வந்தனர்.";
        var words = WordsOf(input, Ta);
        Assert.Equal(new[] { "க்ஷத்ரியர்", "மற்றும்", "ஸ்ரீநிவாசன்", "வந்தனர்" }, words);
    }

    // -------------------------------------------------------------
    // RTL Scripts: Arabic, Persian, Hebrew, Urdu
    // -------------------------------------------------------------

    [Fact]
    public void Arabic_01_ExtractLookupKeys_StripsTashkeelHarakat()
    {
        const string input = "كَتَبَ الطَّالِبُ «كِتَابًا» فِي عَامِ 2026، وَقَالَتْ: «مَرْحَبًا!»";

        // With standard letter/mark class
        var words = WordsOf(input, Ar);
        Assert.Equal(new[] { "كَتَبَ", "الطَّالِبُ", "كِتَابًا", "فِي", "عَامِ", "وَقَالَتْ", "مَرْحَبًا" }, words);

        var keys = LookupKeysOf(input, Ar);
        Assert.Equal(new[] { "كتب", "الطالب", "كتابا", "في", "عام", "وقالت", "مرحبا" }, keys);

        // With digits class
        var wordsWithDigits = WordsOf(input, ArWithDigits);
        Assert.Equal(new[] { "كَتَبَ", "الطَّالِبُ", "كِتَابًا", "فِي", "عَامِ", "2026", "وَقَالَتْ", "مَرْحَبًا" }, wordsWithDigits);

        var keysWithDigits = LookupKeysOf(input, ArWithDigits);
        Assert.Equal(new[] { "كتب", "الطالب", "كتابا", "في", "عام", "2026", "وقالت", "مرحبا" }, keysWithDigits);
    }

    [Fact]
    public void Arabic_02_ExtractLookupKeys_BiDiAndTashkeelStripping()
    {
        const string input = "أَطْلَقَتْ شَرِكَةُ OpenAI نُسْخَةَ 2026 وَقَالَتْ: «مَرْحَبًا!»";
        var keys = LookupKeysOf(input, ArWithDigits);
        Assert.Equal(new[] { "اطلقت", "شركة", "openai", "نسخة", "2026", "وقالت", "مرحبا" }, keys);
    }

    [Fact]
    public void Arabic_TatweelAndHarakatStripping_OnNormalizedKey()
    {
        const string tatweelWord = "مَـكْـتَـبَـةِ";
        var key = Tokenizer.NormalizeKey(tatweelWord, Ar);
        Assert.Equal("مكتبة", key);
    }

    [Fact]
    public void Persian_01_PreservesMultipleZWNJ()
    {
        const string input = "من به کتاب\u200Cخانه\u200Cهای بزرگ می\u200Cروم؟";
        var words = WordsOf(input, Fa);
        Assert.Equal(new[] { "من", "به", "کتاب\u200Cخانه\u200Cهای", "بزرگ", "می\u200Cروم" }, words);
        Assert.Equal(new[] { "من", "به", "کتاب\u200Cخانه\u200Cهای", "بزرگ", "می\u200Cروم" }, LookupKeysOf(input, Fa));
    }

    [Fact]
    public void Persian_02_StripsKasraAndHamzaAboveForLookup()
    {
        const string input = "او ۴۵٬۰۰۰ ریال برایِ خانهٔ نو داد.";
        var words = WordsOf(input, Fa);
        Assert.Contains("برایِ", words);
        Assert.Contains("خانهٔ", words);

        Assert.Equal("برای", Tokenizer.NormalizeKey("برایِ", Fa));
        Assert.Equal("خانه", Tokenizer.NormalizeKey("خانهٔ", Fa));
    }

    [Fact]
    public void Hebrew_01_PreservesGershayim_MaqafSplits_StripsNiqqudForLookup()
    {
        const string input = "הַאִם קָרָאתָ אֶת הַדּוּ״חַ שֶׁל צה״ל בְּ־2026?";

        var words = WordsOf(input, He);
        Assert.Equal(new[] { "הַאִם", "קָרָאתָ", "אֶת", "הַדּוּ״חַ", "שֶׁל", "צה״ל", "בְּ" }, words);

        var keys = LookupKeysOf(input, He);
        Assert.Equal(new[] { "האם", "קראת", "את", "הדו״ח", "של", "צה״ל", "ב" }, keys);

        // With digits enabled, 2026 is tokenized separately because Maqaf ־ is not a connector
        var wordsWithDigits = WordsOf(input, HeWithDigits);
        Assert.Equal(new[] { "הַאִם", "קָרָאתָ", "אֶת", "הַדּוּ״חַ", "שֶׁל", "צה״ל", "בְּ", "2026" }, wordsWithDigits);

        var keysWithDigits = LookupKeysOf(input, HeWithDigits);
        Assert.Equal(new[] { "האם", "קראת", "את", "הדו״ח", "של", "צה״ל", "ב", "2026" }, keysWithDigits);
    }

    [Fact]
    public void Hebrew_02_PreservesGershayimAndAsciiQuoteInAcronyms()
    {
        const string input1 = "חברת Apple מכרה 1,500 מכשירים בת״א.";
        var words1 = WordsOf(input1, He);
        Assert.Contains("בת״א", words1);
        Assert.Equal("בת״א", Tokenizer.NormalizeKey("בת״א", He));

        // ASCII quote inside Hebrew acronym
        const string input2 = "הדו\"ח של צה\"ל";
        var words2 = WordsOf(input2, He);
        Assert.Equal(new[] { "הדו\"ח", "של", "צה\"ל" }, words2);
        Assert.Equal(new[] { "הדו״ח", "של", "צה״ל" }, LookupKeysOf(input2, He));
        Assert.Equal("צה״ל", Tokenizer.NormalizeKey("צה\"ל", He));
        Assert.Equal("צה״ל", Tokenizer.NormalizeKey("צה״ל", He));
        Assert.Equal("תנ׳ך", Tokenizer.NormalizeKey("תנ'ך", He));
        Assert.Equal("תנ׳ך", Tokenizer.NormalizeKey("תנ׳ך", He));

        // Hebrew Geresh inside acronym
        const string input3 = "תנ״ך וגב׳ כהן";
        var words3 = WordsOf(input3, He);
        Assert.Equal("תנ״ך", words3[0]);
    }

    [Fact]
    public void PreservesIndicVowelMarks_NeverStripsMnGlobally()
    {
        Assert.Equal("किताब", Tokenizer.StripLookupDiacritics("किताब", "hi"));
        Assert.Equal("किताब", Tokenizer.NormalizeKey("किताब", Hi));
        Assert.Equal("বই", Tokenizer.NormalizeKey("বই", Bn));
        Assert.Equal("தமிழ்", Tokenizer.NormalizeKey("தமிழ்", Ta));
    }

    [Fact]
    public void TrimsLeadingAndTrailingZwnjZwj_WhilePreservingInternal()
    {
        Assert.Equal("می\u200Cروم", Tokenizer.NormalizeKey("می\u200Cروم", Fa));
        Assert.Equal("র\u200D্যাব", Tokenizer.NormalizeKey("র\u200D্যাব", Bn));

        Assert.Equal("کتاب", Tokenizer.NormalizeKey("\u200Cکتاب\u200C", Fa));
        Assert.Equal("বই", Tokenizer.NormalizeKey("\u200Dবই\u200D", Bn));

        var words = WordsOf("کتاب\u200C نو", new Language { Code = "fa", WordCharacters = @"\p{L}\p{M}\u200C\u200D" });
        Assert.Equal("کتاب", words[0]);
    }

    [Fact]
    public void Urdu_01_PreservesZWNJ()
    {
        const string input = "کیا آپ کل اسلام\u200Cآباد جائیں\u200Cگے؟";
        var words = WordsOf(input, Ur);
        Assert.Equal(new[] { "کیا", "آپ", "کل", "اسلام\u200Cآباد", "جائیں\u200Cگے" }, words);
        Assert.Contains('\u200C', words[4]);
    }

    [Fact]
    public void Urdu_02_StripsPeshForLookup()
    {
        const string input = "اُس نے کہا: ”پڑھائی مکمل ہوئی۔“";
        var words = WordsOf(input, Ur);
        Assert.Equal(new[] { "اُس", "نے", "کہا", "پڑھائی", "مکمل", "ہوئی" }, words);

        var keys = LookupKeysOf(input, Ur);
        Assert.Equal(new[] { "اس", "نے", "کہا", "پڑھائی", "مکمل", "ہوئی" }, keys);
        Assert.Equal("اس", Tokenizer.NormalizeKey("اُس", Ur));
    }

    // -------------------------------------------------------------
    // European Stress Marks & Accents: Russian, Ukrainian, Lithuanian
    // -------------------------------------------------------------

    [Fact]
    public void Russian_StripsCombiningAcuteStressMark()
    {
        const string withStress = "молоко\u0301";
        Assert.Equal("молоко", Tokenizer.StripLookupDiacritics(withStress, "ru"));
        Assert.Equal("молоко", Tokenizer.NormalizeKey(withStress, Ru));
        Assert.Equal(new[] { "молоко" }, LookupKeysOf(withStress, Ru));
    }

    [Fact]
    public void Ukrainian_StripsCombiningAcuteStressMark_PreservesApostrophe()
    {
        const string withStress = "п'я\u0301ть";
        Assert.Equal("п'ять", Tokenizer.StripLookupDiacritics(withStress, "uk"));
        Assert.Equal("п'ять", Tokenizer.NormalizeKey(withStress, Uk));
        Assert.Equal(new[] { "п'ять" }, LookupKeysOf(withStress, Uk));
    }

    [Fact]
    public void Lithuanian_StripsCombiningAccents()
    {
        const string word = "e\u0307\u0301jo"; // ė with combining acute
        var normalized = Tokenizer.NormalizeText(word, Lt); // NFC turns e + \u0307 to ė (U+0117)
        Assert.Equal("ė\u0301jo", normalized);

        var stripped = Tokenizer.StripLookupDiacritics(normalized, "lt");
        Assert.Equal("ėjo", stripped);

        Assert.Equal("ėjo", Tokenizer.NormalizeKey(word, Lt));
    }

    // -------------------------------------------------------------
    // StripLookupDiacritics Edge Cases & Parity
    // -------------------------------------------------------------

    [Theory]
    [InlineData("ar-SA", "كَتَبَ", "كتب")]
    [InlineData("fa-IR", "خانهٔ", "خانه")]
    [InlineData("ur-PK", "اُس", "اس")]
    [InlineData("he-IL", "הַאִם", "האם")]
    [InlineData("iw", "הַאִם", "האם")] // Legacy Hebrew ISO code
    [InlineData("ru-RU", "молоко\u0301", "молоко")]
    [InlineData("uk-UA", "п'я\u0301ть", "п'ять")]
    [InlineData("lt-LT", "ė\u0301jo", "ėjo")]
    [InlineData("en", "don't", "don't")]
    [InlineData(null, "كَتَبَ", "كَتَبَ")]
    public void StripLookupDiacritics_HandlesVariousLanguageCodes(string? langCode, string input, string expected)
    {
        Assert.Equal(expected, Tokenizer.StripLookupDiacritics(input, langCode));
    }
}
