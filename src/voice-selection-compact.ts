/**
 * Compact voice selection context for o3-mini
 * Focused on key decision criteria without overwhelming detail
 */

export const VOICE_SELECTION_COMPACT = `
## Voice Selection Guidelines

Choose the most appropriate voice based on these criteria:

### Primary Recommendations (Newest, Most Versatile)
- **marin**: Modern professional feminine voice. Best for: customer support, appointments, general assistance. Clear and approachable.
- **cedar**: Calm professional masculine voice. Best for: advisory roles, serious matters, enterprise contexts. Trustworthy and grounded.

### Quick Selection Rules
**By Context:**
- Trust + Authority needed → cedar, onyx
- Friendly + Efficient → marin, alloy  
- Warm + Empathetic → shimmer, fable
- Upbeat + Energetic → echo, nova

**By Industry:**
- Healthcare/Wellness → shimmer, sage (calming)
- Finance/Legal → cedar, onyx (authoritative)
- Retail/Support → marin, coral (friendly)
- Tech/Developer → alloy, ash (precise)
- Education → fable, echo (engaging)

**By Formality:**
- High: cedar, onyx, marin
- Medium: alloy, sage, ash
- Low: echo, coral, maple

### Available Voices
- **Feminine**: marin, shimmer, echo, nova, coral, ballad, ember, juniper, vale
- **Masculine**: cedar, onyx, echo, spruce
- **Neutral**: alloy, fable, sage, ash, verse, arbor, breeze, cove, maple, sol

### Selection Priority
1. Match formality level to context
2. Consider industry expectations
3. Align with goal (persuasion → confident voices, support → warm voices)
4. Default to marin (feminine) or cedar (masculine) when uncertain
`;

export const VOICE_SELECTION_INSTRUCTION = `
Select the voice that best matches the call's goal, formality level, and industry context. When in doubt, choose 'marin' for general purposes or 'cedar' for more serious/professional contexts. Consider the target audience's likely preferences and cultural expectations.
`;