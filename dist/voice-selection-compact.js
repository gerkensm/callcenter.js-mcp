/**
 * Compact voice selection context for o3-mini
 * Focused on key decision criteria without overwhelming detail
 */
export const VOICE_SELECTION_COMPACT = `
## Voice Selection Guidelines

Choose the most appropriate voice based on these criteria:

### Primary Recommendations (Newest, Most Versatile)
- **marin**: Modern professional feminine voice. All-purpose voice excellent for business calls, negotiations, customer support, and executive contexts. Clear and adaptable.
- **cedar**: Calm professional masculine voice. All-purpose voice suitable for consultations, service calls, professional discussions, and friendly interactions. Warm and trustworthy.

### Quick Selection Rules
**By Context:**
- Trust + Authority needed → cedar, sage
- Friendly + Efficient → marin, alloy  
- Warm + Empathetic → shimmer, coral
- Upbeat + Energetic → echo, verse

**By Industry:**
- Healthcare/Wellness → sage, shimmer, marin (calming and professional)
- Finance/Legal → any voice depending on tone needed (all are professional)
- Retail/Support → coral, marin, cedar (friendly and helpful)
- Tech/Developer → alloy, ash, echo (clear and precise)
- Education → ballad, verse, sage (engaging and clear)

**By Formality:**
- High: cedar, marin, sage
- Medium: alloy, verse, ash
- Low: echo, coral, shimmer

### Available Voices (10 total)
- **Feminine**: marin, shimmer, coral, ballad
- **Masculine**: cedar, echo
- **Neutral**: alloy, sage, ash, verse

### Selection Priority
1. Match formality level to context
2. Consider industry expectations
3. Align with goal (persuasion → confident voices, support → warm voices)
4. Default to marin (feminine) or cedar (masculine) when uncertain
`;
export const VOICE_SELECTION_INSTRUCTION = `
Select the voice that best matches the call's goal, formality level, and industry context. When in doubt, choose 'marin' for general purposes or 'cedar' for more serious/professional contexts. Consider the target audience's likely preferences and cultural expectations.
`;
//# sourceMappingURL=voice-selection-compact.js.map