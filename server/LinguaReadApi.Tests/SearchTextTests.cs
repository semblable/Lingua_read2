using LinguaReadApi.Utilities;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// The C# side of the accent- and case-insensitive search. It stands in for Postgres's
/// unaccent(lower(x)) on the in-memory test database, so it should fold like unaccent does; the
/// expectations below are what unaccent 1.1 on Postgres 18 returns for the same input.
/// </summary>
public class SearchTextTests
{
    [Theory]
    [InlineData("Sob SANÇÃO", "sob sancao")]
    [InlineData("être", "etre")]
    [InlineData("Ça va, Noël à l'école", "ca va, noel a l'ecole")]
    [InlineData("Músicas", "musicas")]
    [InlineData("Łódź Źdźbło żółć", "lodz zdzblo zolc")]
    [InlineData("Ærø", "aero")]
    [InlineData("œuvre", "oeuvre")]
    [InlineData("Ørsted", "orsted")]
    [InlineData("Đakovo, Ðóra", "dakovo, dora")]
    [InlineData("Þór", "thor")]
    [InlineData("Straße", "strasse")]
    [InlineData("İstanbul ılık", "istanbul ilik")]
    [InlineData("1ª edição, nº 2", "1a edicao, no 2")]
    [InlineData("L’Étranger — Camus", "l'etranger - camus")]
    [InlineData("Άλφα", "αλφα")]
    public void Fold_DropsAccentsAndCase(string text, string expected)
    {
        Assert.Equal(expected, SearchText.Fold(text));
    }

    [Fact]
    public void Fold_HandlesDecomposedInput()
    {
        // "sanção" typed with combining marks folds like the precomposed form.
        var decomposed = "sanc" + (char)0x0327 + "a" + (char)0x0303 + "o";

        Assert.Equal("sancao", SearchText.Fold(decomposed));
    }

    [Fact]
    public void Fold_KeepsCyrillicLettersApartExceptYo()
    {
        // unaccent leaves й a letter of its own (йод is not иод); ё is the one Cyrillic letter it folds.
        Assert.Equal("йод", SearchText.Fold("Йод"));
        Assert.NotEqual(SearchText.Fold("йод"), SearchText.Fold("иод"));
        Assert.Equal(SearchText.Fold("елка"), SearchText.Fold("ЁЛКА"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Fold_NullOrEmpty_IsEmpty(string? text)
    {
        Assert.Equal(string.Empty, SearchText.Fold(text));
    }
}
