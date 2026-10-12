# Vendor components (as pasted by the product owner)

These are third-party React components (21st.dev style) the owner wants used across Sufra.
They are the original sources. Copy them into `src/components/ui/` and adapt them to Sufra's
identity (colors, fonts, RTL, local assets) rather than editing these originals.

| File | Planned place in Sufra |
| --- | --- |
| tilted-grid-hero.tsx | Customer home hero: restaurant and dish photos curving across |
| ai-thinking-orb-and-input.tsx | "Ask Sufra" concierge on the customer home |
| polaroid-line-carousel.tsx | Editors' picks / "your memories" strip |
| lens-zoom-carousel.tsx | Restaurant page gallery |
| skiper39.tsx (CrowdCanvas) | Gateway page: "Customer / Restaurant / Supplier?" |
| contribution-skyline.tsx | Restaurant dashboard: a year of orders |
| activity-heatmap.tsx | Customer profile: your visits this year |
| group-chat.tsx | Plan an outing with friends (invite flow) |
| user-table.tsx | Restaurant dashboard: staff; supplier: customers |
| voxel-story-video-card.tsx | Restaurant page: "from the kitchen" video |
| voxel-video-streak-card.tsx | Customer profile: points and visit streak |
| shiny-button.tsx | Primary CTAs (Book, Subscribe) |
| otp-input.tsx | Phone verification at sign-up/login |
| password-strength.tsx | Sign-up |
| loading-button.tsx | Confirm booking / pay |
| progress-bar.tsx | Onboarding, uploads |
| task-steps.tsx | Order tracking |
| hold-to-confirm.tsx | Cancel booking, destructive actions |
| matte-alert-feedback.tsx / matte-stack-feedback.tsx | Notifications |
| draggable-widget-grid.tsx | Restaurant owner dashboard |
| reorder-list.tsx | Menu section ordering in dashboard |
| agentic-factory-3d.tsx | "How Sufra works" 3D machine on the restaurant marketing page |

Notes from the owner's paste:
- `ai-thiking-orb-and-input.tsx` imports `../../index.css`; only the keyframes were provided (in `ai-orb-keyframes.css`). The `mo-*` class styles were NOT provided and must be written.
- `activity-heatmap.tsx` imports `activity-heatmap-utils/motion-tokens` and `activity-heatmap.module.css`, which were NOT provided and must be written. Its CSS variables are in `activity-heatmap-vars.css`.
- `matte-*-feedback.tsx` use `fb-*` classes whose CSS was NOT provided.
- Dependencies named: motion, gsap, three, lucide-react, blobatar, @blobatar/react, tw-animate-css.
