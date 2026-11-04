using System.Text;
using System.Text.RegularExpressions;

namespace LinguaReadApi.Services.Tokenization;

/// <summary>
/// Lookup-only Korean canonical aliases. Never use these to rewrite stored terms
/// or displayed text: compatibility Jamo and conflicting vocabulary rows stay distinct.
/// Callers supply their existing trimmed/cased exact keys.
/// </summary>
public static class KoreanLookup
{
    public static bool IsKoreanLanguageCode(string? code) =>
        string.Equals((code ?? string.Empty).Trim().Replace('_', '-').Split('-')[0], "ko", StringComparison.OrdinalIgnoreCase);

    public sealed record Projection(string Text, IReadOnlyList<int> SourceStarts, IReadOnlyList<int> SourceEnds);
    public readonly record struct SourceSpan(int Start, int End);

    public sealed record KoreanTokenAnalysis(string Lemma, string Particle, string ParticleType);
    public sealed record KoreanVerbAnalysis(string Lemma, string Particle, string ParticleType);
    public sealed record KoreanLemmaCandidate(string Lemma, string Particle, string ParticleType, bool DictionaryValidated, int Rank);

    private static readonly Lazy<HashSet<string>> KrdictHeadwords = new(() =>
    {
        using var stream = typeof(KoreanLookup).Assembly.GetManifestResourceStream("LinguaReadApi.KrdictLemmas")
            ?? throw new InvalidOperationException("Embedded KRDICT headwords are missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet(StringComparer.Ordinal);
    });

    public static IReadOnlyList<KoreanLemmaCandidate> RankKoreanCandidates(
        IEnumerable<KoreanTokenAnalysis> candidates, IReadOnlySet<string>? headwords = null,
        IReadOnlyDictionary<string, int>? frequencies = null)
    {
        headwords ??= KrdictHeadwords.Value;
        var unique = candidates.DistinctBy(candidate => candidate.Lemma, StringComparer.Ordinal).ToArray();
        var anyValidated = unique.Any(candidate => headwords.Contains(candidate.Lemma));
        return unique.Where(candidate => !anyValidated || headwords.Contains(candidate.Lemma))
            .OrderByDescending(candidate => frequencies?.GetValueOrDefault(candidate.Lemma) ?? 0)
            .ThenBy(candidate => candidate.Lemma, StringComparer.Ordinal)
            .Select(candidate => new KoreanLemmaCandidate(candidate.Lemma, candidate.Particle, candidate.ParticleType,
                headwords.Contains(candidate.Lemma), anyValidated ? 0 : 1)).ToArray();
    }

    /// <summary>Lookup-only ambiguity expansion, mirrored by analyzeKoreanCandidates.</summary>
    public static IReadOnlyList<KoreanLemmaCandidate> AnalyzeKoreanCandidates(string surface)
    {
        var s = ComposeHangul(surface ?? "");
        if (s.Length == 0 || s.Any(c => c is < '\uac00' or > '\ud7a3')) return [];
        var candidates = new List<KoreanTokenAnalysis>();
        var primary = AnalyzeKoreanToken(s);
        if (primary != null) candidates.Add(primary);
        void Add(string lemma, string particle, string type) => candidates.Add(new(lemma, particle, type));
        if (KrdictHeadwords.Value.Contains(s) || OneSyllableNouns.Contains(s) || s is "길이" or "먹이" or "놀이" or "높이") Add(s, "", "Noun");
        if (s is "길이" or "먹이") Add(s[..^1], "이", "Subject Marker");
        if (s == "놀이") Add("놀다", "이", "Nominalizer");
        if (s == "높이") Add("높다", "이", "Nominalizer");
        void OpenAndRieul(string stem, string ending, string type)
        {
            if (stem.Length == 0) return;
            var (cho, jung, jong) = DecomposeHangulSyllable(stem[^1]);
            if (cho < 0) return;
            Add(stem + "다", ending, type);
            if (jong == 0) Add(stem[..^1] + ComposeHangulSyllable(cho, jung, 8) + "다", ending, type);
        }
        foreach (var ending in new[] { "시었습니다", "셨습니다", "셨습니까", "십니다", "십니까", "시는데", "시네요", "시어요", "세요", "셔요", "시다", "시는", "신다", "시네", "시고", "시", "는다", "는데", "ㄴ데", "는", "네" })
        {
            if (s.EndsWith(ending, StringComparison.Ordinal) && s.Length > ending.Length)
                OpenAndRieul(s[..^ending.Length], ending, ending.StartsWith("시", StringComparison.Ordinal) || ending.StartsWith("십", StringComparison.Ordinal) || ending == "세요" ? "Honorific Form" : "Verb Ending");
        }
        foreach (var (tail, jong, marker, type) in new[] {
            ("다", 4, "ㄴ다", "Indicative Form"), ("데", 4, "ㄴ데", "Connective Form"),
            ("니다", 17, "ㅂ니다", "Formal Polite"), ("니까", 17, "ㅂ니까", "Formal Polite"),
            ("", 4, "ㄴ", "Modifier Form"), ("", 8, "ㄹ", "Modifier Form") })
        {
            if (tail.Length > 0 && !s.EndsWith(tail, StringComparison.Ordinal)) continue;
            var stem = tail.Length > 0 ? s[..^tail.Length] : s;
            if (stem.Length == 0) continue;
            var last = DecomposeHangulSyllable(stem[^1]);
            if (last.Jong != jong) continue;
            OpenAndRieul(stem[..^1] + ComposeHangulSyllable(last.Cho, last.Jung, 0), marker, type);
        }
        var ranked = RankKoreanCandidates(candidates);
        return primary == null && ranked.Count == 1 && ranked[0].Lemma == s ? [] : ranked;
    }

    private enum BatchimCondition
    {
        Any,
        RequiresBatchim,
        RequiresNoBatchim,
        RequiresNonRieulBatchim,
        RequiresNoBatchimOrRieul
    }

    private sealed record ParticleRule(string Particle, BatchimCondition Condition, string ParticleType);

    public static bool HasBatchim(char c) => c is >= '\uac00' and <= '\ud7a3' && (c - 0xac00) % 28 > 0;

    public static int GetBatchim(char c) => c is >= '\uac00' and <= '\ud7a3' ? (c - 0xac00) % 28 : 0;

    private static bool CheckBatchim(char c, BatchimCondition condition)
    {
        if (c is < '\uac00' or > '\ud7a3') return false;
        var jong = (c - 0xac00) % 28;
        return condition switch
        {
            BatchimCondition.Any => true,
            BatchimCondition.RequiresBatchim => jong > 0,
            BatchimCondition.RequiresNoBatchim => jong == 0,
            BatchimCondition.RequiresNonRieulBatchim => jong > 0 && jong != 8,
            BatchimCondition.RequiresNoBatchimOrRieul => jong == 0 || jong == 8,
            _ => false
        };
    }

    // Free 1-syllable noun whitelist (~160 common words)
    private static readonly HashSet<string> OneSyllableNouns = new(StringComparer.Ordinal)
    {
        "책", "집", "밥", "물", "눈", "손", "발", "말", "일", "길", "꽃", "돈", "술", "옷", "방", "문",
        "산", "강", "달", "별", "해", "비", "차", "배", "숲", "밤", "낮", "꿈", "땀", "힘", "흙", "돌",
        "새", "소", "개", "닭", "쥐", "곰", "뱀", "봄", "빵", "떡", "면", "콩", "쌀", "살", "피", "뼈",
        "귀", "코", "입", "이", "턱", "목", "등", "팔", "볼", "혀", "털", "몸", "간", "골", "땅", "풀",
        "잎", "씨", "빛", "색", "맛", "멋", "끝", "값", "빚", "글", "뜻", "날", "곳", "점", "속", "겉",
        "앞", "뒤", "밑", "위", "옆", "칼", "줄", "끈", "통", "병", "잔", "상", "벽", "창", "총", "활",
        "솥", "잠", "숨", "정", "덕", "복", "한", "얼", "넋", "티", "짐", "법", "시", "분", "초", "쪽",
        "편", "짝", "놈", "남", "적", "신", "철", "국", "탕", "죽", "회", "김", "꿀", "깨", "감", "귤",
        "잣", "알", "양", "벌", "용", "꿩", "늪", "샘", "틀", "못", "닻", "돛", "갓", "탈", "윷", "틈",
        "덤", "몫", "꼴", "때", "첫", "약", "불", "춤", "키", "빗", "삯", "볕", "판", "품", "결", "곁"
    };

    private static readonly HashSet<string> AgentNouns = new(StringComparer.Ordinal)
    {
        "정치가", "만화가", "음악가", "소설가", "전문가", "예술가", "자본가", "사업가", "운동가", "작가",
        "화가", "건축가", "사진가", "사상가", "비평가", "평론가", "연출가", "과학가", "무용가", "철학가", "탐험가"
    };

    private static readonly HashSet<string> LoanwordsNa = new(StringComparer.Ordinal)
    {
        "바나나", "코로나", "사우나", "안테나"
    };

    private static readonly HashSet<string> ProtectedWords = new(StringComparer.Ordinal)
    {
        "오이", "포도", "사자", "지도", "고속도로", "민주주의", "바나나", "코로나", "정치가", "만화가",
        "선거제도", "교육제도", "사법제도", "한반도", "피아노", "카메라", "드라마", "시네마"
    };

    private static readonly ParticleRule[] Copulas =
    {
        new("입니다", BatchimCondition.Any, "Copula"),
        new("이에요", BatchimCondition.RequiresBatchim, "Copula"),
        new("예요", BatchimCondition.RequiresNoBatchim, "Copula"),
        new("이다", BatchimCondition.Any, "Copula"),
        new("이었다", BatchimCondition.RequiresBatchim, "Copula"),
        new("였다", BatchimCondition.RequiresNoBatchim, "Copula")
    };

    private static readonly ParticleRule[] Slot3Rules =
    {
        new("이나마", BatchimCondition.RequiresBatchim, "Delimiter"),
        new("나마", BatchimCondition.RequiresNoBatchim, "Delimiter"),
        new("이라도", BatchimCondition.RequiresBatchim, "Delimiter"),
        new("라도", BatchimCondition.RequiresNoBatchim, "Delimiter"),
        new("이라서", BatchimCondition.RequiresBatchim, "Causal Marker"),
        new("라서", BatchimCondition.RequiresNoBatchim, "Causal Marker"),
        new("이란", BatchimCondition.RequiresBatchim, "Topic Marker"),
        new("란", BatchimCondition.RequiresNoBatchim, "Topic Marker"),
        new("이나", BatchimCondition.RequiresBatchim, "Delimiter"),
        new("나", BatchimCondition.RequiresNoBatchim, "Delimiter"),
        new("이며", BatchimCondition.RequiresBatchim, "Connective Marker"),
        new("며", BatchimCondition.RequiresNoBatchim, "Connective Marker"),
        new("부터", BatchimCondition.Any, "Starting Point Marker"),
        new("까지", BatchimCondition.Any, "Ending Point Marker"),
        new("은", BatchimCondition.RequiresBatchim, "Topic Marker"),
        new("는", BatchimCondition.RequiresNoBatchim, "Topic Marker"),
        new("이", BatchimCondition.RequiresBatchim, "Subject Marker"),
        new("가", BatchimCondition.RequiresNoBatchim, "Subject Marker"),
        new("을", BatchimCondition.RequiresBatchim, "Object Marker"),
        new("를", BatchimCondition.RequiresNoBatchim, "Object Marker"),
        new("도", BatchimCondition.Any, "Additive Marker"),
        new("만", BatchimCondition.Any, "Exclusive Marker"),
        new("아", BatchimCondition.RequiresBatchim, "Vocative Marker"),
        new("야", BatchimCondition.RequiresNoBatchim, "Vocative Marker")
    };

    private static readonly ParticleRule[] Slot2Rules =
    {
        new("으로서", BatchimCondition.RequiresNonRieulBatchim, "Role Marker"),
        new("으로써", BatchimCondition.RequiresNonRieulBatchim, "Instrumental Marker"),
        new("로서", BatchimCondition.RequiresNoBatchimOrRieul, "Role Marker"),
        new("로써", BatchimCondition.RequiresNoBatchimOrRieul, "Instrumental Marker"),
        new("으로", BatchimCondition.RequiresNonRieulBatchim, "Instrumental Marker"),
        new("로", BatchimCondition.RequiresNoBatchimOrRieul, "Instrumental Marker"),
        new("께서", BatchimCondition.Any, "Honorific Subject Marker"),
        new("에서", BatchimCondition.Any, "Locative Marker"),
        new("에게", BatchimCondition.Any, "Dative Marker"),
        new("한테", BatchimCondition.Any, "Dative Marker"),
        new("하고", BatchimCondition.Any, "Connective Marker"),
        new("보다", BatchimCondition.Any, "Comparative Marker"),
        new("처럼", BatchimCondition.Any, "Comparative Marker"),
        new("마다", BatchimCondition.Any, "Every"),
        new("조차", BatchimCondition.Any, "Even"),
        new("마저", BatchimCondition.Any, "Even"),
        new("께", BatchimCondition.Any, "Honorific Dative Marker"),
        new("에", BatchimCondition.Any, "Locative/Time Marker"),
        new("과", BatchimCondition.RequiresBatchim, "Connective Marker"),
        new("와", BatchimCondition.RequiresNoBatchim, "Connective Marker"),
        new("의", BatchimCondition.Any, "Possessive Marker")
    };

    private static string CombineParticleTypes(string? plural, string? slot2Type, string? slot3Type)
    {
        if (plural != null)
        {
            if (slot2Type != null && slot3Type != null)
                return $"Plural + {slot2Type.Replace(" Marker", "")} + {slot3Type}";
            if (slot2Type != null)
                return $"Plural + {slot2Type}";
            if (slot3Type != null)
                return $"Plural + {slot3Type}";
            return "Plural Marker";
        }

        if (slot2Type != null && slot3Type != null)
            return $"{slot2Type.Replace(" Marker", "")} + {slot3Type}";
        if (slot2Type != null) return slot2Type;
        if (slot3Type != null) return slot3Type;
        return string.Empty;
    }

    private static bool ShouldSkipParticle(string target, string particle)
    {
        if (particle == "로" || particle.StartsWith("로"))
        {
            if (target.EndsWith("으로")) return true;
            if (target.EndsWith("도로") && target.Length >= 3) return true;
        }
        if (particle == "의" || particle.StartsWith("의"))
        {
            if (target.EndsWith("주의") && target.Length >= 3) return true;
        }
        if (particle == "도")
        {
            if ((target.EndsWith("제도") || target.EndsWith("반도")) && target.Length >= 3) return true;
        }
        if (particle == "가" && AgentNouns.Contains(target))
        {
            return true;
        }
        if (particle == "나" && LoanwordsNa.Contains(target))
        {
            return true;
        }
        if (particle == "만" && target.EndsWith("지만"))
        {
            return true;
        }
        return false;
    }

    private static bool IsStemValid(string stem, string surface, string particle)
    {
        if (string.IsNullOrEmpty(stem)) return false;
        foreach (var ch in stem)
        {
            if (ch is < '\uac00' or > '\ud7a3') return false;
        }

        if (stem.Length == 1 && !OneSyllableNouns.Contains(stem))
        {
            return false;
        }

        if (ProtectedWords.Contains(surface))
        {
            return false;
        }

        if (particle.EndsWith("로") && surface.EndsWith("도로"))
        {
            return false;
        }

        if (particle.EndsWith("의") && surface.EndsWith("주의"))
        {
            return false;
        }

        if (particle.EndsWith("도") && (surface.EndsWith("제도") || surface.EndsWith("반도")))
        {
            return false;
        }

        if (particle == "가" && AgentNouns.Contains(surface))
        {
            return false;
        }

        if (particle == "나" && LoanwordsNa.Contains(surface))
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// Decomposes an inflected Korean surface form into its base lemma, attached particle(s),
    /// and particle classification badge. Returns null if no particle is attached.
    /// </summary>
    public static KoreanTokenAnalysis? AnalyzeKoreanToken(string surface)
    {
        if (string.IsNullOrWhiteSpace(surface)) return null;
        var s = ComposeHangul(surface);
        if (s.Length < 2) return null;
        foreach (var ch in s)
        {
            if (ch is < '\uac00' or > '\ud7a3') return null;
        }

        // 1. Check copula endings
        foreach (var copula in Copulas)
        {
            if (s.EndsWith(copula.Particle) && s.Length > copula.Particle.Length)
            {
                var charBefore = s[s.Length - copula.Particle.Length - 1];
                if (CheckBatchim(charBefore, copula.Condition))
                {
                    var rem = s[..^copula.Particle.Length];
                    if (rem.EndsWith("들") && rem.Length >= 2)
                    {
                        var remWithoutDeul = rem[..^1];
                        var fullParticle = s[remWithoutDeul.Length..];
                        if (IsStemValid(remWithoutDeul, s, fullParticle))
                        {
                            return new KoreanTokenAnalysis(remWithoutDeul, fullParticle, "Plural + Copula");
                        }
                    }

                    var particle = s[rem.Length..];
                    if (IsStemValid(rem, s, particle))
                    {
                        return new KoreanTokenAnalysis(rem, particle, copula.ParticleType);
                    }
                }
            }
        }

        // 2. Check Slot 3 (optionally preceded by Slot 2, optionally preceded by Slot 1 -들)
        foreach (var slot3 in Slot3Rules)
        {
            if (s.EndsWith(slot3.Particle) && s.Length > slot3.Particle.Length)
            {
                if (ShouldSkipParticle(s, slot3.Particle)) continue;
                var charBefore = s[s.Length - slot3.Particle.Length - 1];
                if (CheckBatchim(charBefore, slot3.Condition))
                {
                    var rem1 = s[..^slot3.Particle.Length];

                    // Can Slot 2 attach before Slot 3?
                    foreach (var slot2 in Slot2Rules)
                    {
                        if (rem1.EndsWith(slot2.Particle) && rem1.Length > slot2.Particle.Length)
                        {
                            if (ShouldSkipParticle(rem1, slot2.Particle)) continue;
                            var charBefore2 = rem1[rem1.Length - slot2.Particle.Length - 1];
                            if (CheckBatchim(charBefore2, slot2.Condition))
                            {
                                var rem2 = rem1[..^slot2.Particle.Length];
                                if (rem2.EndsWith("들") && rem2.Length >= 2)
                                {
                                    var rem3 = rem2[..^1];
                                    var fullParticle = s[rem3.Length..];
                                    if (IsStemValid(rem3, s, fullParticle))
                                    {
                                        return new KoreanTokenAnalysis(rem3, fullParticle, CombineParticleTypes("Plural Marker", slot2.ParticleType, slot3.ParticleType));
                                    }
                                }

                                var particle23 = s[rem2.Length..];
                                if (IsStemValid(rem2, s, particle23))
                                {
                                    return new KoreanTokenAnalysis(rem2, particle23, CombineParticleTypes(null, slot2.ParticleType, slot3.ParticleType));
                                }
                            }
                        }
                    }

                    // No Slot 2; check -들 before Slot 3
                    if (rem1.EndsWith("들") && rem1.Length >= 2)
                    {
                        var rem2 = rem1[..^1];
                        var fullParticle = s[rem2.Length..];
                        if (IsStemValid(rem2, s, fullParticle))
                        {
                            return new KoreanTokenAnalysis(rem2, fullParticle, CombineParticleTypes("Plural Marker", null, slot3.ParticleType));
                        }
                    }

                    var particle3 = s[rem1.Length..];
                    if (IsStemValid(rem1, s, particle3))
                    {
                        return new KoreanTokenAnalysis(rem1, particle3, slot3.ParticleType);
                    }
                }
            }
        }

        // 3. Check Slot 2 only (optionally preceded by Slot 1 -들)
        foreach (var slot2 in Slot2Rules)
        {
            if (s.EndsWith(slot2.Particle) && s.Length > slot2.Particle.Length)
            {
                if (ShouldSkipParticle(s, slot2.Particle)) continue;
                var charBefore = s[s.Length - slot2.Particle.Length - 1];
                if (CheckBatchim(charBefore, slot2.Condition))
                {
                    var rem1 = s[..^slot2.Particle.Length];
                    if (rem1.EndsWith("들") && rem1.Length >= 2)
                    {
                        var rem2 = rem1[..^1];
                        var fullParticle = s[rem2.Length..];
                        if (IsStemValid(rem2, s, fullParticle))
                        {
                            return new KoreanTokenAnalysis(rem2, fullParticle, CombineParticleTypes("Plural Marker", slot2.ParticleType, null));
                        }
                    }

                    var particle2 = s[rem1.Length..];
                    if (IsStemValid(rem1, s, particle2))
                    {
                        return new KoreanTokenAnalysis(rem1, particle2, slot2.ParticleType);
                    }
                }
            }
        }

        // 4. Check Slot 1 -들 only
        if (s.EndsWith("들") && s.Length >= 2)
        {
            var rem = s[..^1];
            if (IsStemValid(rem, s, "들"))
            {
                return new KoreanTokenAnalysis(rem, "들", "Plural Marker");
            }
        }

        return DeconjugateKoreanVerb(s);
    }

    public static (int Cho, int Jung, int Jong) DecomposeHangulSyllable(char c)
    {
        if (c is < '\uac00' or > '\ud7a3') return (-1, -1, -1);
        var code = c - 0xac00;
        var jong = code % 28;
        var jung = (code / 28) % 21;
        var cho = code / (28 * 21);
        return (cho, jung, jong);
    }

    public static char ComposeHangulSyllable(int cho, int jung, int jong) =>
        (char)(0xac00 + (cho * 21 + jung) * 28 + jong);

    private static readonly HashSet<string> PureOneSyllableNouns = new(StringComparer.Ordinal)
    {
        "책", "꽃", "돈", "술", "옷", "방", "문", "산", "강", "별", "숲", "새", "소", "개", "떡", "빵", "집", "밥", "물", "눈", "손", "발"
    };

    private static readonly Dictionary<string, string> HIrregularPresentMap = new(StringComparer.Ordinal)
    {
        { "하얘", "하얗" },
        { "하예", "하얗" },
        { "하애", "하얗" },
        { "그래", "그렇" },
        { "이래", "이렇" },
        { "저래", "저렇" },
        { "어때", "어떻" },
        { "노래", "노랗" },
        { "파래", "파랗" },
        { "빨개", "빨갛" },
        { "까매", "까맣" }
    };

    private static readonly Dictionary<string, string> HIrregularModifierMap = new(StringComparer.Ordinal)
    {
        { "하얀", "하얗" },
        { "그런", "그렇" },
        { "이런", "이렇" },
        { "저런", "저렇" },
        { "어떤", "어떻" },
        { "노란", "노랗" },
        { "파란", "파랗" },
        { "빨간", "빨갛" },
        { "까만", "까맣" }
    };

    private static readonly HashSet<string> DIrregularLStems = new(StringComparer.Ordinal)
    {
        "들", "걸", "깨달", "물", "실"
    };

    private static readonly HashSet<string> SIrregularStems = new(StringComparer.Ordinal)
    {
        "나", "지", "부", "이"
    };

    private static readonly HashSet<string> WudaStems = new(StringComparer.Ordinal)
    {
        "배", "키", "지", "세", "채", "태", "피", "치", "비", "깨", "가두", "겨누", "나누", "거두"
    };

    private static string? ResolveEoASyllable(string stemPrefix, char last)
    {
        var (cho, jung, jong) = DecomposeHangulSyllable(last);
        if (cho < 0 || jong != 0) return null;

        // 1. 하다 verbs
        if (last == '해')
        {
            return stemPrefix + "하";
        }

        // 2. 르 irregular (stemPrefix ends with ㄹ batchim, last is 라 or 러)
        if (stemPrefix.Length >= 1 && (last == '라' || last == '러'))
        {
            var prevChar = stemPrefix[^1];
            var (pCho, pJung, pJong) = DecomposeHangulSyllable(prevChar);
            if (pJong == 8) // ㄹ batchim
            {
                var pWithoutRieul = ComposeHangulSyllable(pCho, pJung, 0);
                return stemPrefix[..^1] + pWithoutRieul + "르";
            }
        }

        // 3. ㅂ irregular with 와 (돕다, 곱다)
        if (last == '와')
        {
            if (stemPrefix.EndsWith("도"))
                return stemPrefix[..^1] + "돕";
            if (stemPrefix.EndsWith("고"))
                return stemPrefix[..^1] + "곱";
        }

        // 4. ㅂ irregular with 워
        if (last == '워')
        {
            if (stemPrefix.Length >= 1)
            {
                foreach (var wuda in WudaStems)
                {
                    if (stemPrefix.EndsWith(wuda))
                        return stemPrefix + "우";
                }
                var prevChar = stemPrefix[^1];
                var (pCho, pJung, pJong) = DecomposeHangulSyllable(prevChar);
                if (pJong == 0) // no batchim -> add ㅂ
                {
                    var pWithB = ComposeHangulSyllable(pCho, pJung, 17);
                    return stemPrefix[..^1] + pWithB;
                }
            }
        }

        // 5. ㅎ irregular present
        var fullSurface = stemPrefix + last;
        if (HIrregularPresentMap.TryGetValue(fullSurface, out var hStem))
        {
            return hStem;
        }

        // 6. ㅘ (jungseong 9) -> ㅗ (jungseong 8): 보다, 오다
        if (jung == 9)
        {
            return stemPrefix + ComposeHangulSyllable(cho, 8, 0);
        }

        // 7. ㅝ (jungseong 14) with cho != 11 (ㅇ): 주다, 꾸다, 추다
        if (jung == 14 && cho != 11)
        {
            return stemPrefix + ComposeHangulSyllable(cho, 13, 0);
        }

        // 8. ㅕ (jungseong 6) -> ㅣ (jungseong 20): 마시다, 가르치다, 기다리다
        if (jung == 6)
        {
            return stemPrefix + ComposeHangulSyllable(cho, 20, 0);
        }

        // 9. ㅡ elision
        if (string.IsNullOrEmpty(stemPrefix))
        {
            if (last == '써') return "쓰";
            if (last == '커') return "크";
            if (last == '떠') return "뜨";
            if (last == '꺼') return "끄";
        }
        else
        {
            if (cho == 8) // ㅃ: 예뻐 -> 예쁘, 바빠 -> 바쁘, 기뻐 -> 기쁘, 나빠 -> 나쁘
            {
                return stemPrefix + ComposeHangulSyllable(cho, 18, 0);
            }
            if (cho == 17) // ㅍ: 아파 -> 아프, 슬퍼 -> 슬프
            {
                return stemPrefix + ComposeHangulSyllable(cho, 18, 0);
            }
            if (last == '가' && (stemPrefix.EndsWith("담") || stemPrefix.EndsWith("잠")))
            {
                return stemPrefix + "그";
            }
        }

        // 10. Regular vowel ㅏ stem: 가, 자, 사, 타, 만나, 떠나
        if (jung == 0)
        {
            return stemPrefix + last;
        }

        // 11. Regular vowel ㅓ stem: 서, 펴
        if (jung == 4)
        {
            return stemPrefix + last;
        }

        // 12. Regular vowel ㅐ stem: 보내, 지내, 내
        if (jung == 1)
        {
            return stemPrefix + last;
        }

        // 13. ㅙ (jungseong 10) -> ㅚ (jungseong 11): 되다 (돼 -> 되)
        if (jung == 10)
        {
            return stemPrefix + ComposeHangulSyllable(cho, 11, 0);
        }

        return null;
    }

    /// <summary>
    /// Deconjugates an inflected Korean verb or adjective form into its base dictionary lemma (ending in '다'),
    /// the attached verbal ending (eomi), and the grammatical classification badge.
    /// Returns null if not a recognized inflected verbal form.
    /// </summary>
    public static KoreanTokenAnalysis? DeconjugateKoreanVerb(string surface)
    {
        if (string.IsNullOrWhiteSpace(surface)) return null;
        var s = ComposeHangul(surface);
        if (s.Length == 0) return null;
        foreach (var ch in s)
        {
            if (ch is < '\uac00' or > '\ud7a3') return null;
        }
        if (ProtectedWords.Contains(s)) return null;

        // 1-syllable verbs
        if (s.Length == 1)
        {
            var (cCho, cJung, cJong) = DecomposeHangulSyllable(s[0]);
            if (cJong == 4) // ㄴ batchim
            {
                if (s == "간") return new KoreanTokenAnalysis("가다", "ㄴ", "Modifier Form");
                if (s == "본") return new KoreanTokenAnalysis("보다", "ㄴ", "Modifier Form");
                if (s == "한") return new KoreanTokenAnalysis("하다", "ㄴ", "Modifier Form");
            }
            if (cJong == 8) // ㄹ batchim
            {
                if (s == "갈") return new KoreanTokenAnalysis("가다", "ㄹ", "Modifier Form");
                if (s == "볼") return new KoreanTokenAnalysis("보다", "ㄹ", "Modifier Form");
                if (s == "할") return new KoreanTokenAnalysis("하다", "ㄹ", "Modifier Form");
            }
            return null;
        }

        // 1. Honorific verb endings
        if (s.EndsWith("으셨습니다") && s.Length >= 6 && HasBatchim(s[s.Length - 6]))
            return new KoreanTokenAnalysis(s[..^5] + "다", "으셨습니다", "Honorific Past Polite");
        if (s.EndsWith("셨습니다") && s.Length >= 5 && !HasBatchim(s[s.Length - 5]))
            return new KoreanTokenAnalysis(s[..^4] + "다", "셨습니다", "Honorific Past Polite");
        if (s.EndsWith("으시었습니다") && s.Length >= 7 && HasBatchim(s[s.Length - 7]))
            return new KoreanTokenAnalysis(s[..^6] + "다", "으시었습니다", "Honorific Past Polite");
        if (s.EndsWith("시었습니다") && s.Length >= 6 && !HasBatchim(s[s.Length - 6]))
            return new KoreanTokenAnalysis(s[..^5] + "다", "시었습니다", "Honorific Past Polite");
        if (s.EndsWith("으셨어요") && s.Length >= 5 && HasBatchim(s[s.Length - 5]))
            return new KoreanTokenAnalysis(s[..^4] + "다", "으셨어요", "Honorific Past Polite");
        if (s.EndsWith("셨어요") && s.Length >= 4 && !HasBatchim(s[s.Length - 4]))
            return new KoreanTokenAnalysis(s[..^3] + "다", "셨어요", "Honorific Past Polite");
        if (s.EndsWith("으시었어요") && s.Length >= 6 && HasBatchim(s[s.Length - 6]))
            return new KoreanTokenAnalysis(s[..^5] + "다", "으시었어요", "Honorific Past Polite");
        if (s.EndsWith("시었어요") && s.Length >= 5 && !HasBatchim(s[s.Length - 5]))
            return new KoreanTokenAnalysis(s[..^4] + "다", "시었어요", "Honorific Past Polite");
        if (s.EndsWith("으시지요") && s.Length >= 5 && HasBatchim(s[s.Length - 5]))
            return new KoreanTokenAnalysis(s[..^4] + "다", "으시지요", "Honorific Polite");
        if (s.EndsWith("시지요") && s.Length >= 4 && !HasBatchim(s[s.Length - 4]))
            return new KoreanTokenAnalysis(s[..^3] + "다", "시지요", "Honorific Polite");
        if (s.EndsWith("으시죠") && s.Length >= 4 && HasBatchim(s[s.Length - 4]))
            return new KoreanTokenAnalysis(s[..^3] + "다", "으시죠", "Honorific Polite");
        if (s.EndsWith("시죠") && s.Length >= 3 && !HasBatchim(s[s.Length - 3]))
            return new KoreanTokenAnalysis(s[..^2] + "다", "시죠", "Honorific Polite");
        if (s.EndsWith("으세요") && s.Length >= 4 && HasBatchim(s[s.Length - 4]))
            return new KoreanTokenAnalysis(s[..^3] + "다", "으세요", "Honorific Polite");
        if (s.EndsWith("세요") && s.Length >= 3 && !HasBatchim(s[s.Length - 3]))
            return new KoreanTokenAnalysis(s[..^2] + "다", "세요", "Honorific Polite");
        if (s.EndsWith("셔요") && s.Length >= 3 && !s.StartsWith("마셔") && !s.StartsWith("모셔") && !HasBatchim(s[s.Length - 3]))
            return new KoreanTokenAnalysis(s[..^2] + "다", "셔요", "Honorific Polite");
        if (s.EndsWith("시어") && s.Length >= 3 && !HasBatchim(s[s.Length - 3]))
            return new KoreanTokenAnalysis(s[..^2] + "다", "시어", "Honorific");

        // 2. Formal polite endings
        if (s.EndsWith("습니다") && s.Length >= 4)
        {
            var charBefore = s[^4];
            var (cbCho, cbJung, cbJong) = DecomposeHangulSyllable(charBefore);
            if (s == "있습니다")
                return new KoreanTokenAnalysis("있다", "습니다", "Formal Polite");
            if (s == "없습니다")
                return new KoreanTokenAnalysis("없다", "습니다", "Formal Polite");

            // Past tense before 습니다 (batchim ㅆ)
            if (cbJong == 20)
            {
                if (charBefore == '었' || charBefore == '았')
                {
                    var stemBefore = s[..^4];
                    if (stemBefore.Length >= 1 && DIrregularLStems.Contains(stemBefore))
                    {
                        var (lCho, lJung, _) = DecomposeHangulSyllable(stemBefore[^1]);
                        stemBefore = stemBefore[..^1] + ComposeHangulSyllable(lCho, lJung, 7); // ㄷ
                    }
                    else if (stemBefore.Length >= 1 && SIrregularStems.Contains(stemBefore))
                    {
                        var (lCho, lJung, _) = DecomposeHangulSyllable(stemBefore[^1]);
                        stemBefore = stemBefore[..^1] + ComposeHangulSyllable(lCho, lJung, 19); // ㅅ
                    }
                    var p = charBefore == '았' ? "았습니다" : "었습니다";
                    return new KoreanTokenAnalysis(stemBefore + "다", p, "Past Formal Polite");
                }

                // Contracted with ㅆ (갔습니다, 왔습니다, 봤습니다, 줬습니다, 했습니다, 예뻤습니다, 바빴습니다...)
                var last = ComposeHangulSyllable(cbCho, cbJung, 0);
                var stemPrefix = s[..^4];
                var resolved = ResolveEoASyllable(stemPrefix, last);
                if (resolved != null)
                {
                    var p = last == '해' ? "했습니다" : (cbJung == 0 || cbJung == 9 ? "았습니다" : "었습니다");
                    return new KoreanTokenAnalysis(resolved + "다", p, "Past Formal Polite");
                }
            }

            if (cbJong > 0)
            {
                var rem = s[..^3];
                return new KoreanTokenAnalysis(rem + "다", "습니다", "Formal Polite");
            }
        }

        if (s.EndsWith("습니까") && s.Length >= 4)
        {
            var charBefore = s[^4];
            if (HasBatchim(charBefore))
            {
                return new KoreanTokenAnalysis(s[..^3] + "다", "습니까", "Formal Polite Question");
            }
        }

        if (s.EndsWith("니다") && s.Length >= 3)
        {
            var charBefore = s[^3];
            var (cbCho, cbJung, cbJong) = DecomposeHangulSyllable(charBefore);
            if (cbJong == 17) // ㅂ batchim
            {
                var charWithoutB = ComposeHangulSyllable(cbCho, cbJung, 0);
                var rem = s[..^3] + charWithoutB;
                return new KoreanTokenAnalysis(rem + "다", "ㅂ니다", "Formal Polite");
            }
        }

        if (s.EndsWith("니까") && s.Length >= 3)
        {
            var charBefore = s[^3];
            var (cbCho, cbJung, cbJong) = DecomposeHangulSyllable(charBefore);
            if (cbJong == 17) // ㅂ batchim: -ㅂ니까
            {
                var charWithoutB = ComposeHangulSyllable(cbCho, cbJung, 0);
                var rem = s[..^3] + charWithoutB;
                return new KoreanTokenAnalysis(rem + "다", "ㅂ니까", "Formal Polite Question");
            }
        }

        // 3. Past tense informal polite (-았어요, -었어요)
        if ((s.EndsWith("어요") || s.EndsWith("아요")) && s.Length >= 2)
        {
            var endingLen = 2;
            var charBefore = s[s.Length - endingLen - 1];
            var (cbCho, cbJung, cbJong) = DecomposeHangulSyllable(charBefore);
            if (cbJong == 20) // ㅆ batchim
            {
                if (charBefore == '었' || charBefore == '았')
                {
                    var stemBefore = s[..^(endingLen + 1)];
                    if (stemBefore.Length >= 1 && DIrregularLStems.Contains(stemBefore))
                    {
                        var (lCho, lJung, _) = DecomposeHangulSyllable(stemBefore[^1]);
                        stemBefore = stemBefore[..^1] + ComposeHangulSyllable(lCho, lJung, 7); // ㄷ
                    }
                    else if (stemBefore.Length >= 1 && SIrregularStems.Contains(stemBefore))
                    {
                        var (lCho, lJung, _) = DecomposeHangulSyllable(stemBefore[^1]);
                        stemBefore = stemBefore[..^1] + ComposeHangulSyllable(lCho, lJung, 19); // ㅅ
                    }
                    var p = charBefore == '았' ? "았어요" : "었어요";
                    return new KoreanTokenAnalysis(stemBefore + "다", p, "Past Polite");
                }

                var last = ComposeHangulSyllable(cbCho, cbJung, 0);
                var stemPrefix = s[..^(endingLen + 1)];
                var resolved = ResolveEoASyllable(stemPrefix, last);
                if (resolved != null)
                {
                    var p = last == '해' ? "했어요" : (cbJung == 0 || cbJung == 9 ? "았어요" : "었어요");
                    return new KoreanTokenAnalysis(resolved + "다", p, "Past Polite");
                }
            }
        }

        // 4. Present tense informal polite (-아요, -었어요, -여요, -해요)
        if (s.EndsWith("요") && s.Length >= 2)
        {
            var rem = s[..^1];
            var last = rem[^1];
            var stemPrefix = rem[..^1];
            var (lCho, lJung, lJong) = DecomposeHangulSyllable(last);

            if (last == '해')
            {
                var resolved = ResolveEoASyllable(stemPrefix, last);
                return new KoreanTokenAnalysis(resolved + "다", "해요", "Present Polite");
            }

            if (last == '어' || last == '아' || last == '여')
            {
                if (stemPrefix.Length >= 1)
                {
                    if (DIrregularLStems.Contains(stemPrefix))
                    {
                        var (pCho, pJung, _) = DecomposeHangulSyllable(stemPrefix[^1]);
                        var stemD = stemPrefix[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
                        return new KoreanTokenAnalysis(stemD + "다", last + "요", "Present Polite");
                    }
                    if (SIrregularStems.Contains(stemPrefix))
                    {
                        var (pCho, pJung, _) = DecomposeHangulSyllable(stemPrefix[^1]);
                        var stemS = stemPrefix[..^1] + ComposeHangulSyllable(pCho, pJung, 19);
                        return new KoreanTokenAnalysis(stemS + "다", last + "요", "Present Polite");
                    }
                    var (pCho2, pJung2, pJong2) = DecomposeHangulSyllable(stemPrefix[^1]);
                    if (pJong2 > 0)
                    {
                        return new KoreanTokenAnalysis(stemPrefix + "다", last + "요", "Present Polite");
                    }
                }
            }

            if (lJong == 0)
            {
                var resolved = ResolveEoASyllable(stemPrefix, last);
                if (resolved != null)
                {
                    var p = (lJung == 0 || lJung == 9) ? "아요" : "어요";
                    return new KoreanTokenAnalysis(resolved + "다", p, "Present Polite");
                }
            }
        }

        // 5. Converb / Causal / Sequential (-아서, -어서, -여서, -해서)
        if (s.EndsWith("서") && s.Length >= 2)
        {
            var rem = s[..^1];
            var last = rem[^1];
            var stemPrefix = rem[..^1];
            var (lCho, lJung, lJong) = DecomposeHangulSyllable(last);

            if (last == '해')
            {
                var resolved = ResolveEoASyllable(stemPrefix, last);
                return new KoreanTokenAnalysis(resolved + "다", "해서", "Causal/Sequential");
            }

            if (last == '어' || last == '아' || last == '여')
            {
                if (stemPrefix.Length >= 1)
                {
                    if (DIrregularLStems.Contains(stemPrefix))
                    {
                        var (pCho, pJung, _) = DecomposeHangulSyllable(stemPrefix[^1]);
                        var stemD = stemPrefix[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
                        return new KoreanTokenAnalysis(stemD + "다", last + "서", "Causal/Sequential");
                    }
                    if (SIrregularStems.Contains(stemPrefix))
                    {
                        var (pCho, pJung, _) = DecomposeHangulSyllable(stemPrefix[^1]);
                        var stemS = stemPrefix[..^1] + ComposeHangulSyllable(pCho, pJung, 19);
                        return new KoreanTokenAnalysis(stemS + "다", last + "서", "Causal/Sequential");
                    }
                    var (pCho2, pJung2, pJong2) = DecomposeHangulSyllable(stemPrefix[^1]);
                    if (pJong2 > 0)
                    {
                        return new KoreanTokenAnalysis(stemPrefix + "다", last + "서", "Causal/Sequential");
                    }
                }
            }

            if (lJong == 0)
            {
                var resolved = ResolveEoASyllable(stemPrefix, last);
                if (resolved != null)
                {
                    var p = (lJung == 0 || lJung == 9) ? "아서" : "어서";
                    return new KoreanTokenAnalysis(resolved + "다", p, "Causal/Sequential");
                }
            }
        }

        // 6. Connective & Conditional Endings
        if (s.EndsWith("지만") && s.Length >= 3)
        {
            var rem = s[..^2];
            return new KoreanTokenAnalysis(rem + "다", "지만", "Contrastive");
        }

        if (s.EndsWith("는데") && s.Length >= 3)
        {
            var rem = s[..^2];
            return new KoreanTokenAnalysis(rem + "다", "는데", "Connective/Background");
        }

        if (s.EndsWith("은데") && s.Length >= 3 && (HasBatchim(s[^3]) || SIrregularStems.Contains(s[..^2])))
        {
            var rem = s[..^2];
            if (DIrregularLStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
            }
            else if (SIrregularStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 19);
            }
            return new KoreanTokenAnalysis(rem + "다", "은데", "Connective/Background");
        }

        if (s.EndsWith("데") && s.Length >= 2)
        {
            var charBefore = s[^2];
            var (cbCho, cbJung, cbJong) = DecomposeHangulSyllable(charBefore);
            if (cbJong == 4) // ㄴ batchim
            {
                if (s.EndsWith("그런데")) return new KoreanTokenAnalysis("그렇다", "ㄴ데", "Connective/Background");
                if (s.EndsWith("이런데")) return new KoreanTokenAnalysis("이렇다", "ㄴ데", "Connective/Background");
                if (s.EndsWith("저런데")) return new KoreanTokenAnalysis("저렇다", "ㄴ데", "Connective/Background");
                if (s.EndsWith("어려운데")) return new KoreanTokenAnalysis("어렵다", "ㄴ데", "Connective/Background");
                if (s.EndsWith("추운데")) return new KoreanTokenAnalysis("춥다", "ㄴ데", "Connective/Background");
                if (s.EndsWith("더운데")) return new KoreanTokenAnalysis("덥다", "ㄴ데", "Connective/Background");
                if (s.EndsWith("쉬운데")) return new KoreanTokenAnalysis("쉽다", "ㄴ데", "Connective/Background");
                var charWithoutN = ComposeHangulSyllable(cbCho, cbJung, 0);
                var rem = s[..^2] + charWithoutN;
                return new KoreanTokenAnalysis(rem + "다", "ㄴ데", "Connective/Background");
            }
        }

        if (s.EndsWith("으면") && s.Length >= 3 && (HasBatchim(s[^3]) || SIrregularStems.Contains(s[..^2])))
        {
            var rem = s[..^2];
            if (DIrregularLStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
            }
            else if (SIrregularStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 19);
            }
            return new KoreanTokenAnalysis(rem + "다", "으면", "Conditional");
        }

        if (s.EndsWith("면") && s.Length >= 2)
        {
            var charBefore = s[^2];
            var jong = GetBatchim(charBefore);
            if (jong == 0 || jong == 8)
            {
                var rem = s[..^1];
                if (!PureOneSyllableNouns.Contains(rem))
                {
                    return new KoreanTokenAnalysis(rem + "다", "면", "Conditional");
                }
            }
        }

        if (s.EndsWith("으니까") && s.Length >= 4 && (HasBatchim(s[^4]) || SIrregularStems.Contains(s[..^3])))
        {
            var rem = s[..^3];
            if (DIrregularLStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
            }
            else if (SIrregularStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 19);
            }
            return new KoreanTokenAnalysis(rem + "다", "으니까", "Causal");
        }

        if (s.EndsWith("니까") && s.Length >= 3 && !HasBatchim(s[^3]))
        {
            var rem = s[..^2];
            return new KoreanTokenAnalysis(rem + "다", "니까", "Causal");
        }

        if (s.EndsWith("으려고") && s.Length >= 4 && (HasBatchim(s[^4]) || SIrregularStems.Contains(s[..^3])))
        {
            var rem = s[..^3];
            if (DIrregularLStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
            }
            else if (SIrregularStems.Contains(rem))
            {
                var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 19);
            }
            return new KoreanTokenAnalysis(rem + "다", "으려고", "Intentional");
        }

        if (s.EndsWith("려고") && s.Length >= 3)
        {
            var charBefore = s[^3];
            var jong = GetBatchim(charBefore);
            if (jong == 0 || jong == 8)
            {
                var rem = s[..^2];
                return new KoreanTokenAnalysis(rem + "다", "려고", "Intentional");
            }
        }

        if (s.EndsWith("고") && s.Length >= 2)
        {
            var rem = s[..^1];
            if (!PureOneSyllableNouns.Contains(rem))
            {
                return new KoreanTokenAnalysis(rem + "다", "고", "Connective");
            }
        }

        // 7. Adnominal / Modifier forms
        if (s.EndsWith("던") && s.Length >= 2)
        {
            var rem = s[..^1];
            if (!PureOneSyllableNouns.Contains(rem))
            {
                var (cbCho, cbJung, cbJong) = DecomposeHangulSyllable(rem[^1]);
                if (cbJong == 20) // ㅆ past batchim: 했던, 갔던, 봤던, 왔던, 먹었던
                {
                    if (rem[^1] == '었' || rem[^1] == '았')
                    {
                        var stemBefore = rem[..^1];
                        if (stemBefore.Length >= 1 && DIrregularLStems.Contains(stemBefore))
                        {
                            var (lCho, lJung, _) = DecomposeHangulSyllable(stemBefore[^1]);
                            stemBefore = stemBefore[..^1] + ComposeHangulSyllable(lCho, lJung, 7);
                        }
                        else if (stemBefore.Length >= 1 && SIrregularStems.Contains(stemBefore))
                        {
                            var (lCho, lJung, _) = DecomposeHangulSyllable(stemBefore[^1]);
                            stemBefore = stemBefore[..^1] + ComposeHangulSyllable(lCho, lJung, 19);
                        }
                        return new KoreanTokenAnalysis(stemBefore + "다", "던", "Modifier Form");
                    }

                    var last = ComposeHangulSyllable(cbCho, cbJung, 0);
                    var stemPrefix = rem[..^1];
                    var resolved = ResolveEoASyllable(stemPrefix, last);
                    if (resolved != null)
                    {
                        return new KoreanTokenAnalysis(resolved + "다", "던", "Modifier Form");
                    }
                }
                return new KoreanTokenAnalysis(rem + "다", "던", "Modifier Form");
            }
        }

        if (s.EndsWith("는") && s.Length >= 2)
        {
            var rem = s[..^1];
            if (!PureOneSyllableNouns.Contains(rem))
            {
                return new KoreanTokenAnalysis(rem + "다", "는", "Modifier Form");
            }
        }

        if (s.EndsWith("은") && s.Length >= 2 && (HasBatchim(s[^2]) || SIrregularStems.Contains(s[..^1])))
        {
            var rem = s[..^1];
            if (!PureOneSyllableNouns.Contains(rem))
            {
                if (DIrregularLStems.Contains(rem))
                {
                    var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                    rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
                }
                else if (SIrregularStems.Contains(rem))
                {
                    var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                    rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 19);
                }
                return new KoreanTokenAnalysis(rem + "다", "은", "Modifier Form");
            }
        }

        if (s.EndsWith("을") && s.Length >= 2 && HasBatchim(s[^2]))
        {
            var rem = s[..^1];
            if (!PureOneSyllableNouns.Contains(rem))
            {
                if (DIrregularLStems.Contains(rem))
                {
                    var (pCho, pJung, _) = DecomposeHangulSyllable(rem[^1]);
                    rem = rem[..^1] + ComposeHangulSyllable(pCho, pJung, 7);
                }
                return new KoreanTokenAnalysis(rem + "다", "을", "Modifier Form");
            }
        }

        // Fused ㄴ / ㄹ modifier endings
        var lastChar = s[^1];
        var (mCho, mJung, mJong) = DecomposeHangulSyllable(lastChar);
        if (mJong == 4) // ㄴ batchim
        {
            if (HIrregularModifierMap.TryGetValue(s, out var hStem))
                return new KoreanTokenAnalysis(hStem + "다", "ㄴ", "Modifier Form");

            if (lastChar == '운' && s.Length >= 2)
            {
                if (s == "도운") return new KoreanTokenAnalysis("돕다", "ㄴ", "Modifier Form");
                var stemBefore = s[..^1];
                var hasWuda = false;
                foreach (var wuda in WudaStems)
                {
                    if (stemBefore.EndsWith(wuda))
                    {
                        hasWuda = true;
                        break;
                    }
                }
                if (hasWuda)
                {
                    return new KoreanTokenAnalysis(stemBefore + "우다", "ㄴ", "Modifier Form");
                }
                var prevChar = s[^2];
                var (pCho, pJung, pJong) = DecomposeHangulSyllable(prevChar);
                if (pJong == 0)
                {
                    var pWithB = ComposeHangulSyllable(pCho, pJung, 17);
                    return new KoreanTokenAnalysis(s[..^2] + pWithB + "다", "ㄴ", "Modifier Form");
                }
            }

            if (lastChar == '한' && s.Length >= 2)
                return new KoreanTokenAnalysis(s[..^1] + "하다", "ㄴ", "Modifier Form");

            if (lastChar == '싼' && s.Length >= 2)
                return new KoreanTokenAnalysis(s[..^1] + "싸다", "ㄴ", "Modifier Form");

            if (mCho == 8 && s.Length >= 2) // 쁜: 예쁜, 바쁜, 나쁜, 기쁜
                return new KoreanTokenAnalysis(s[..^1] + "쁘다", "ㄴ", "Modifier Form");

            if (mCho == 17 && s.Length >= 2) // 픈: 슬픈, 아픈
                return new KoreanTokenAnalysis(s[..^1] + "프다", "ㄴ", "Modifier Form");

            if (lastChar == '른' && s.Length >= 2) // 빠른, 이른
                return new KoreanTokenAnalysis(s[..^1] + "르다", "ㄴ", "Modifier Form");

            if (lastChar == '린' && s.Length >= 2) // 느린
                return new KoreanTokenAnalysis(s[..^1] + "리다", "ㄴ", "Modifier Form");

            if (lastChar == '난' && s.Length >= 2) // 떠난, 만난
                return new KoreanTokenAnalysis(s[..^1] + "나다", "ㄴ", "Modifier Form");

            if (lastChar == '간' && s.Length >= 3) // 돌아간, 나아간
                return new KoreanTokenAnalysis(s[..^1] + "가다", "ㄴ", "Modifier Form");

            if (lastChar == '본' && s.Length >= 3) // 돌아본, 살펴본
                return new KoreanTokenAnalysis(s[..^1] + "보다", "ㄴ", "Modifier Form");

            if (lastChar == '준' && s.Length >= 3) // 도와준
                return new KoreanTokenAnalysis(s[..^1] + "주다", "ㄴ", "Modifier Form");
        }

        if (mJong == 8) // ㄹ batchim
        {
            var prevChar = s[^2];
            var (pCho, pJung, pJong) = DecomposeHangulSyllable(prevChar);
            if (pJong == 0 && !PureOneSyllableNouns.Contains(s[..^1]))
            {
                if (lastChar == '쌀' && s.Length >= 2)
                    return new KoreanTokenAnalysis(s[..^1] + "싸다", "ㄹ", "Modifier Form");

                if (mCho == 8 && s.Length >= 2) // 쁠: 예쁠
                    return new KoreanTokenAnalysis(s[..^1] + "쁘다", "ㄹ", "Modifier Form");

                if (lastChar == '를' && s.Length >= 2) // 빠를
                    return new KoreanTokenAnalysis(s[..^1] + "르다", "ㄹ", "Modifier Form");

                if (lastChar == '할' && s.Length >= 2) // 공부할
                    return new KoreanTokenAnalysis(s[..^1] + "하다", "ㄹ", "Modifier Form");

                if (lastChar == '갈' && s.Length >= 3) // 돌아갈
                    return new KoreanTokenAnalysis(s[..^1] + "가다", "ㄹ", "Modifier Form");

                if (lastChar == '볼' && s.Length >= 3) // 돌아볼
                    return new KoreanTokenAnalysis(s[..^1] + "보다", "ㄹ", "Modifier Form");
            }

            if (lastChar == '날' && s.Length >= 2 && !PureOneSyllableNouns.Contains(s[..^1])) // 만날, 떠날
                return new KoreanTokenAnalysis(s[..^1] + "나다", "ㄹ", "Modifier Form");
        }

        return null;
    }

    /// <summary>Each composed UTF-16 unit maps to its complete original source span.</summary>
    public static Projection Project(string source)
    {
        var text = new StringBuilder(source.Length);
        var starts = new List<int>(source.Length);
        var ends = new List<int>(source.Length);
        for (var start = 0; start < source.Length;)
        {
            var code = (int)source[start];
            var end = start + 1;
            if (code is >= 0x1100 and <= 0x1112 && end < source.Length && source[end] is >= '\u1161' and <= '\u1175')
            {
                code = 0xac00 + ((code - 0x1100) * 21 + source[end] - 0x1161) * 28;
                end++;
            }
            if (code is >= 0xac00 and <= 0xd7a3 && (code - 0xac00) % 28 == 0
                && end < source.Length && source[end] is >= '\u11a8' and <= '\u11c2')
            {
                code += source[end] - 0x11a7;
                end++;
            }
            text.Append((char)code);
            starts.Add(start);
            ends.Add(end);
            start = end;
        }
        return new Projection(text.ToString(), starts, ends);
    }

    public static string ComposeHangul(string source) => Project(source).Text;

    public sealed class Index<T> where T : class
    {
        private readonly Dictionary<string, T?> exact = new(StringComparer.Ordinal);
        private readonly Dictionary<string, T?> canonical = new(StringComparer.Ordinal);

        internal Index(IEnumerable<T> rows, Func<T, string> exactKey)
        {
            foreach (var row in rows) Add(row, exactKey);
        }

        /// <summary>Register a newly pending row without rebuilding the language index.</summary>
        public void Add(T row, Func<T, string> exactKey)
        {
            var key = exactKey(row);
            exact[key] = exact.ContainsKey(key) ? null : row;
            var alias = ComposeHangul(key);
            canonical[alias] = canonical.ContainsKey(alias) ? null : row;
        }

        /// <summary>Exact spelling wins; an alias with multiple candidates has no winner.</summary>
        public T? Resolve(string exactKey) => exact.TryGetValue(exactKey, out var row)
            ? row
            : canonical.GetValueOrDefault(ComposeHangul(exactKey));

        /// <summary>True also for an exact key whose stored rows conflict.</summary>
        public bool ContainsExact(string exactKey) => exact.ContainsKey(exactKey);
    }

    public static Index<T> CreateIndex<T>(IEnumerable<T> rows, Func<T, string> exactKey) where T : class => new(rows, exactKey);

    /// <summary>Canonical matches with offsets in the unmodified source, including phrases.</summary>
    public static IReadOnlyList<SourceSpan> FindMatches(string source, string term)
    {
        var projection = Project(source);
        var needle = ComposeHangul(term);
        if (needle.Length == 0) return Array.Empty<SourceSpan>();
        return Regex.Matches(projection.Text, Regex.Escape(needle), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
            .Select(match => new SourceSpan(projection.SourceStarts[match.Index], projection.SourceEnds[match.Index + match.Length - 1]))
            .ToArray();
    }
}
