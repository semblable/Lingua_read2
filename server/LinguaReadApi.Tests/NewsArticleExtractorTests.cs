using LinguaReadApi.Services.News;
using Xunit;

namespace LinguaReadApi.Tests;

public class NewsArticleExtractorTests
{
    [Fact]
    public void ToParagraphs_DropsPhotosBylinesAndLinkBoxes()
    {
        // Shapes taken from BBC News Brasil and g1 article bodies.
        var html = """
            <figure><div><img src="a.jpg"><p role="text"><span>Crédito, </span><span>Luiz Silveira/STF</span></p></div>
              <figcaption><span>Legenda da foto, </span>"Vivemos um momento muito grave", diz a professora.</figcaption></figure>
            <section role="region" aria-labelledby="article-byline"><ul>
              <li><span>Author, </span><a href="/topics/x"></a></li>
              <li><span>Role, </span><span>Da BBC News Brasil em Londres</span></li>
              <li><p><span>Tempo de leitura: 10 min</span></p></li></ul></section>
            <p>Os debates foram marcados por bate-bocas entre os ministros e a falta de definições.</p>
            <div role="region"><p><a href="#end">Pule Mais lidas e continue lendo</a></p>
              <p><strong>Mais lidas</strong></p><ol><li><a href="/a">Uma notícia muito lida hoje no site</a></li></ol></div>
            <h2>As coisas precisam se acalmar antes</h2>
            <p>Segundo especialistas ouvidas pela reportagem, mudanças são necessárias para superar a crise.</p>
            <p><strong>LEIA TAMBÉM:</strong></p>
            <ul><li><a href="/b">Outra reportagem relacionada que o site recomenda</a></li></ul>
            <h2>VÍDEOS: veja tudo sobre a Zona da Mata</h2>
            <p><a href="/cidade/juiz-de-fora">Juiz de Fora</a></p>
            """;

        var paragraphs = ArticleExtractor.ToParagraphs(html);

        Assert.Equal(
            [
                "Os debates foram marcados por bate-bocas entre os ministros e a falta de definições.",
                "As coisas precisam se acalmar antes",
                "Segundo especialistas ouvidas pela reportagem, mudanças são necessárias para superar a crise."
            ],
            paragraphs);
    }

    [Fact]
    public void ToParagraphs_SplitsDoubleLineBreaks_AndJoinsSingleOnes()
    {
        var html = "<p>Primeiro parágrafo,\n com quebra.<br><br>Segundo parágrafo aqui.<br>Mesma linha lógica.</p>";

        Assert.Equal(
            ["Primeiro parágrafo, com quebra.", "Segundo parágrafo aqui. Mesma linha lógica."],
            ArticleExtractor.ToParagraphs(html));
    }

    [Fact]
    public void ToParagraphs_DropsTheTitleAndRepeatedBlocks()
    {
        var html = "<h1>Um título</h1><p>Um parágrafo que conta a notícia.</p><p>Um parágrafo que conta a notícia.</p>";

        Assert.Equal(["Um parágrafo que conta a notícia."], ArticleExtractor.ToParagraphs(html, "Um título"));
    }

    [Fact]
    public void ToParagraphs_DropsPhotoCreditsThatSitOutsideTheirFigure()
    {
        // g1 repeats the caption in a <p> after the <figure>.
        var html = """
            <p>Um militar foi baleado neste sábado em Campo Grande, segundo a polícia.</p>
            <p>Militar do Exército é baleado durante perseguição em Campo Grande — Foto: Divulgação</p>
            <p>Foto: Marcelo Camargo/Agência Brasil</p>
            <p>Manifestants à Paris, samedi (Photo : Thomas Samson / AFP)</p>
            <p>A imagem: um retrato da cidade vista do alto do morro.</p>
            """;

        Assert.Equal(
            ["Um militar foi baleado neste sábado em Campo Grande, segundo a polícia.", "A imagem: um retrato da cidade vista do alto do morro."],
            ArticleExtractor.ToParagraphs(html));
    }

    [Fact]
    public void FromPage_DropsTheFeedsTitleWhenThePageTitleCarriesTheSiteName()
    {
        const string headline = "VÍDEO: militar do Exército é baleado após ser perseguido em Campo Grande";
        var story = string.Concat(Enumerable.Range(1, 6).Select(i =>
            $"<p>Parágrafo {i}: o jovem seguia para a casa da tia quando percebeu que estava sendo acompanhado pelos suspeitos.</p>"));
        var html = $"""
            <html><head><title>{headline} | Mato Grosso do Sul | G1</title></head>
            <body><article><h1>{headline}</h1>{story}</article></body></html>
            """;

        var article = ArticleExtractor.FromPage(html, new Uri("https://g1.globo.com/ms/noticia.ghtml"), headline);

        Assert.StartsWith("Parágrafo 1", article.Paragraphs[0]);
        Assert.DoesNotContain(headline, article.Paragraphs);
    }

    [Fact]
    public void ToParagraphs_KeepsShortSentencesAndQuotes()
    {
        var html = "<p>Chove.</p><p>\"Nunca mais!\"</p><p>Fim da nota</p>";

        Assert.Equal(["Chove.", "\"Nunca mais!\""], ArticleExtractor.ToParagraphs(html));
    }

    [Fact]
    public void ToParagraphs_KeepsARegionThatHoldsTheWholeStory()
    {
        var html = """
            <div role="region">
              <p>Todo o texto da notícia está dentro desta região da página.</p>
              <p>Um segundo parágrafo, também dentro da mesma região.</p>
            </div>
            """;

        Assert.Equal(2, ArticleExtractor.ToParagraphs(html).Count);
    }

    [Fact]
    public void ToParagraphs_FallsBackToTheWholeTextWhenItIsNotInBlocks()
    {
        var html = "<article>Um texto solto sem parágrafos marcados, só com quebras.<br><br>E uma segunda parte do texto.</article>";

        Assert.Equal(
            ["Um texto solto sem parágrafos marcados, só com quebras.", "E uma segunda parte do texto."],
            ArticleExtractor.ToParagraphs(html));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("<script>var x = 1;</script>")]
    public void ToParagraphs_HandlesEmptyInput(string? html)
    {
        Assert.Empty(ArticleExtractor.ToParagraphs(html));
    }

    [Fact]
    public void FromPage_FindsTheArticleInAFullPage()
    {
        var story = string.Join("\n", Enumerable.Range(1, 8).Select(i =>
            $"<p>Parágrafo {i} da reportagem, com frases completas sobre o assunto do dia e bastante texto para a leitura.</p>"));
        var html = $"""
            <!DOCTYPE html>
            <html lang="pt-BR"><head><title>Uma reportagem | Jornal</title></head>
            <body>
              <header><nav><a href="/">Início</a> <a href="/politica">Política</a> <a href="/esportes">Esportes</a></nav></header>
              <main><article>
                <h1>Uma reportagem</h1>
                {story}
              </article></main>
              <aside><h3>Mais lidas</h3><ul><li><a href="/x">Outra notícia qualquer</a></li></ul></aside>
              <footer><p>© Jornal. Todos os direitos reservados.</p></footer>
            </body></html>
            """;

        var article = ArticleExtractor.FromPage(html, new Uri("https://jornal.example.com/reportagem"));

        Assert.Equal(8, article.Paragraphs.Count);
        Assert.StartsWith("Parágrafo 1 da reportagem", article.Paragraphs[0]);
        Assert.DoesNotContain(article.Paragraphs, p => p.Contains("direitos reservados") || p.Contains("Esportes"));
        Assert.Equal(string.Join("\n\n", article.Paragraphs), article.Content);
        Assert.True(article.WordCount > 100);
    }
}
