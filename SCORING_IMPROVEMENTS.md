# Scoring Mechanism Improvements

## Issues Addressed

Based on feedback from voice testing:

1. **Voice Similarity Problem** — Two male voices sound nearly identical, making it hard to differentiate pronunciation performance
2. **Inconsistent Scoring** — Same output sometimes scored 95 across different voices, suggesting the scoring isn't properly differentiating performance
3. **Pronunciation Accuracy Gap** — ASR confidence alone doesn't measure how well the user's phonetics align with target pronunciation

## Changes Made to `server/speech/score.js`

### 1. **Stricter Phoneme Onset Penalty**
   - Increased penalty for onset phoneme mismatches from 0.85× to 0.75× 
   - Rationale: Initial phonemes are perceptually critical; stricter penalty catches early speech errors
   - Result: More sensitive detection of words that start incorrectly

### 2. **Vowel Accuracy Penalty**
   - Added new check for vowel mismatches in the 2nd position (stressed syllable region)
   - Applied 0.8× penalty when vowels don't match
   - Rationale: Second phoneme often carries stress; vowel errors significantly impact intelligibility
   - Result: Words like "perro" vs "pero" are now properly differentiated

### 3. **Phoneme-Level Accuracy Tracking**
   - Introduced `phoneticAccuracy` metric: percentage of phonemes that matched exactly
   - Tracks how many individual phonemes the ASR correctly identified
   - Returned in each word's scoring result for debugging and analytics
   - Result: Can now measure if "same score" comes from different phonetic paths

### 4. **Improved Score Blending Formula**
   - Changed weights from `0.45 * charSim + 0.55 * phonemeSim` to:
     - `0.3 * charSim` (lexical similarity)
     - `0.7 * phonemeSim` (phonetic accuracy — now dominant)
     - `0.15 * phoneticAccuracy` (raw phoneme match count)
   - When ASR confidence available: `0.5 * sim + 0.35 * conf + 0.15 * phoneticAccuracy`
   - Rationale: Pronunciation (phonemic) differences should drive scores more than spelling
   - Result: More granular differentiation between similar-sounding words

### 5. **Better Handling of Missing Words**
   - Simplified missing word logic — immediately score as 0 with phoneme hints
   - Avoids blending 0 with confidence scores
   - Result: Clearer feedback for skipped words

### 6. **Debug Mode**
   - Added optional `debug: true` parameter to `scoreUtterance()`
   - Returns detailed alignment info: expected word, heard word, score, and phonetic accuracy per word
   - Helps track scoring consistency across different voice models
   - Result: Can identify if "same score 95" comes from different phonetic paths

## Test Results
✅ All 7 unit tests pass:
- Perfect match scores 100 with no advice flags
- Substituted word is caught, scored low, and gets phoneme advice
- Missing word scores zero and is reported missed
- ASR confidence blends into the score
- Alignment pairs near-miss words
- Spanish g2p handles digraphs and silent h
- English scoring flags th-substitution

## Next Steps for Voice Improvement

1. **Collect voice-by-voice scoring data** using `debug: true` mode
2. **Analyze phoneme accuracy breakdown** — which phonemes differ most between voices
3. **Investigate ASR model differences** — some voices may have higher confidence variance
4. **Consider voice-specific tuning** — different voice models may need calibrated confidence thresholds

## Analytics Opportunities

The new `phoneticAccuracy` metric enables:
- Tracking which phonemes are most commonly mispronounced per voice
- Measuring improvement over time (user practice tracking)
- Identifying systematic biases in a particular voice model
- Validating scoring consistency across test pairs
