/**
 * Built-in Spam Template Library
 * @file scripts/data/spam-templates.js
 * @module cyberpunkred-messenger
 * @description Pre-written Night City spam messages across 7 categories.
 *              Templates support variable tokens: {{playerName}}, {{networkName}},
 *              {{currentDate}}, {{randomCorpo}}, {{randomDistrict}}.
 *              GMs can create custom templates that mix into this pool.
 */

// ─── Flavor pools for {{randomCorpo}} and {{randomDistrict}} tokens ───

export const RANDOM_CORPOS = [
  'Arasaka', 'Militech', 'Kang Tao', 'Biotechnica', 'Petrochem',
  'Zetatech', 'Orbital Air', 'Trauma Team', 'Kiroshi', 'Dynalar',
  'Raven Microcybernetics', 'Netwatch', 'SovOil', 'Kendachi',
  'Zhirafa', 'Continental Brands', 'Network News 54', 'DMS',
];

export const RANDOM_DISTRICTS = [
  'Watson', 'Westbrook', 'City Center', 'Heywood', 'Pacifica',
  'Santo Domingo', 'Kabuki', 'Japantown', 'Arroyo', 'Rancho Coronado',
  'Wellsprings', 'Charter Hill', 'Vista Del Rey', 'The Glen',
  'Northside Industrial', 'Coastview', 'Little China',
];

/**
 * Spam categories with icon and color metadata
 */
export const SPAM_CATEGORIES = {
  corpo:       { label: 'Corpo',        icon: 'fas fa-building',          color: 'cyan' },
  scam:        { label: 'Scam',         icon: 'fas fa-mask',              color: 'gold' },
  ripperdoc:   { label: 'Ripperdoc',    icon: 'fas fa-syringe',           color: 'red' },
  braindance:  { label: 'Braindance',   icon: 'fas fa-brain',             color: 'purple' },
  political:   { label: 'Political',    icon: 'fas fa-landmark',          color: 'warning' },
  blackmarket: { label: 'Black Mkt',    icon: 'fas fa-skull-crossbones',  color: 'danger' },
  fixer:       { label: 'Fixer',        icon: 'fas fa-handshake',         color: 'green' },
};

/**
 * Built-in spam template pool.
 * @type {Array<object>}
 */
export const BUILTIN_SPAM_TEMPLATES = [

  // ═══════════════════════════════════════════
  //  CORPO ADS (8)
  // ═══════════════════════════════════════════

  {
    id: 'corpo-01',
    category: 'corpo',
    fromName: 'Arasaka Wellness Division',
    fromEmail: 'wellness@arasaka.corp',
    subject: 'Your Annual Cyberware Audit Is Overdue',
    body: `Dear {{playerName}},

Our records indicate your implant insurance has lapsed as of {{currentDate}}. Per Night City Municipal Code §47.3b, all registered cyberware must undergo annual compliance inspection.

Failure to schedule your audit within 30 days may result in warranty voiding on all Arasaka-manufactured implants, suspension of neural link access privileges, and referral to Night City Cyberware Enforcement Division.

Schedule your audit today at any Arasaka-certified clinic. Present this message for a complimentary neural diagnostic scan.

Arasaka — Your Future, Our Promise.`,
  },
  {
    id: 'corpo-02',
    category: 'corpo',
    fromName: 'Trauma Team International',
    fromEmail: 'plans@traumateam.corp',
    subject: 'Trauma Team Platinum — Save 15% This Month',
    body: `{{playerName}}, life in {{randomDistrict}} is unpredictable. Are you covered?

Trauma Team Platinum gives you priority extraction with a guaranteed 3-minute response time anywhere in Night City. This month only, upgrade from Gold to Platinum and save 15%.

Features include: armed aerial medevac, on-site combat surgery, full cyberware diagnostics, and legal liability coverage for collateral damage during extraction.

Don't wait until you flatline. Upgrade today.

Trauma Team — Because Everyone Deserves A Second Chance.`,
  },
  {
    id: 'corpo-03',
    category: 'corpo',
    fromName: 'Kiroshi Optics',
    fromEmail: 'upgrade@kiroshi.corp',
    subject: 'See More. Know More. Kiroshi Mk.IV Now Available.',
    body: `The future of optical cyberware is here.

Introducing Kiroshi Optishield Mk.IV — featuring 12K resolution scanning, real-time facial recognition, integrated threat assessment HUD, and our new NightStar low-light mode.

Trade in your old optics at any authorized dealer and receive up to 2,000 eb credit toward your Mk.IV installation.

Available now at certified ripperdocs in {{randomDistrict}} and City Center.

Kiroshi — The World, Enhanced.`,
  },
  {
    id: 'corpo-04',
    category: 'corpo',
    fromName: '{{randomCorpo}} HR Division',
    fromEmail: 'careers@megacorp.net',
    subject: 'Career Opportunity — Security Contractor Position',
    body: `{{randomCorpo}} is actively recruiting skilled contractors for immediate placement in our {{randomDistrict}} operations.

Requirements: combat training, basic cyberware proficiency, clean criminal record (waivable for exceptional candidates), and willingness to sign a standard NDA with neural compliance monitoring.

Compensation: 800-1,200 eb/week plus dental, trauma coverage, and corporate housing eligibility after 90 days.

Apply through your local {{randomCorpo}} office. Walk-ins accepted Monday through Saturday.

This is an automated recruitment message. Do not reply directly.`,
  },
  {
    id: 'corpo-05',
    category: 'corpo',
    fromName: 'Petrochem EcoSolutions',
    fromEmail: 'green@petrochem.corp',
    subject: 'Petrochem Clean Water Initiative — Your Community Matters',
    body: `Petrochem is committed to a cleaner Night City. Our new water purification plants in {{randomDistrict}} are providing clean, affordable drinking water to over 200,000 residents.

As a valued member of the Night City community, we'd like to offer you a free month of Petrochem PureFlow home filtration service.

Claim your trial by visiting any Petrochem community center. No contract required.*

*Standard rates apply after trial period. Service availability subject to district infrastructure. Petrochem reserves the right to monitor water usage for quality assurance purposes.`,
  },

  // ═══════════════════════════════════════════
  //  SCAMS (7)
  // ═══════════════════════════════════════════

  {
    id: 'scam-01',
    category: 'scam',
    fromName: 'NC Lottery Commission',
    fromEmail: 'winner@nclotto.net',
    subject: 'CONGRATULATIONS! You\'ve Won 50,000 eb!',
    body: `Dear {{playerName}},

You have been selected as this month's GRAND PRIZE WINNER in the Night City Digital Lottery! Your prize of 50,000 EURODOLLARS is waiting to be claimed!

To receive your winnings, simply reply to this message with your agent credentials and preferred bank routing information. Processing takes 24-48 hours.

ACT NOW — Prize must be claimed within 7 days or it will be forfeited to the next winner.

This is a legitimate notice from the NC Lottery Commission. Ref#: NCL-{{currentDate}}-7749`,
  },
  {
    id: 'scam-02',
    category: 'scam',
    fromName: 'Lagos Financial Trust',
    fromEmail: 'executor@lagosfinancial.net',
    subject: 'Unclaimed Inheritance — Urgent Response Required',
    body: `Dear {{playerName}},

I am writing to inform you of an unclaimed inheritance totaling 175,000 eb from a deceased relative who maintained accounts with our institution.

Due to Nigerian Banking Regulation §14.7, unclaimed estates are liquidated after 180 days. We have been unable to locate other beneficiaries.

As the closest identified relative, you are entitled to 70% of the total estate. A modest processing fee of 500 eb is required to initiate the transfer.

Please respond with utmost urgency and confidentiality.

Regards,
Dr. Emmanuel Okafor, Esq.
Lagos Financial Trust`,
  },
  {
    id: 'scam-03',
    category: 'scam',
    fromName: 'Night City Revenue Service',
    fromEmail: 'audit@ncrs-notice.gov',
    subject: 'FINAL NOTICE: Outstanding Tax Liability — Immediate Action Required',
    body: `OFFICIAL NOTICE — Night City Revenue Service

Taxpayer: {{playerName}}
District: {{randomDistrict}}
Amount Due: 3,750 eb

Our records indicate an outstanding tax liability on your account. Failure to remit payment within 48 hours will result in asset seizure, wage garnishment, and potential criminal prosecution.

To resolve this matter immediately, transfer the outstanding balance to the following account and reply with your transaction confirmation.

This is your FINAL NOTICE before enforcement action.

NCRS Automated Collections Division`,
  },
  {
    id: 'scam-04',
    category: 'scam',
    fromName: 'CyberSafe Alert System',
    fromEmail: 'alert@cybersafe-nc.com',
    subject: '⚠️ Your Agent Has Been Compromised — Verify Now',
    body: `SECURITY ALERT

{{playerName}}, suspicious activity has been detected on your personal agent. Someone from an unrecognized device in {{randomDistrict}} attempted to access your accounts.

If this was NOT you, click below to verify your identity and secure your agent immediately:

[VERIFY IDENTITY NOW]

Failure to verify within 24 hours will result in automatic account suspension for your protection.

— CyberSafe Automated Security`,
  },
  {
    id: 'scam-05',
    category: 'scam',
    fromName: 'Lucky Dragon Casino',
    fromEmail: 'vip@luckydragon-nc.net',
    subject: 'VIP Invitation — 500 eb Free Play, No Catch',
    body: `{{playerName}}, you've been hand-selected for Lucky Dragon Casino's exclusive VIP program!

As a new VIP member, you'll receive 500 eb in free gaming credits — no deposit required! Plus enjoy complimentary drinks, private gaming rooms, and access to our high-roller braindance lounge.

Simply reply with your agent ID to activate your VIP status. Credits are loaded instantly.

Lucky Dragon Casino — {{randomDistrict}}
"Fortune Favors the Bold"

Must be 18+. Terms and conditions apply. Lucky Dragon Casino is not responsible for personal property, cybernetic damage, or data loss occurring on premises.`,
  },

  // ═══════════════════════════════════════════
  //  RIPPERDOC (5)
  // ═══════════════════════════════════════════

  {
    id: 'ripperdoc-01',
    category: 'ripperdoc',
    fromName: 'Dr. Chrome\'s Discount Implants',
    fromEmail: 'deals@drchrome.nc',
    subject: '⚡ FLASH SALE — Kiroshi Mk.3 Eyes, No Questions Asked',
    body: `Why pay full price? Get military-grade optics at street prices.

This week only at Dr. Chrome's:
- Kiroshi Mk.3 Optics — 40% off
- Gorilla Arms (slightly used) — 1,200 eb
- Subdermal Armor (Grade 2) — 800 eb
- Neural Link Tune-Up — 200 eb

Walk-ins welcome. Back alley entrance only. Cash preferred. No insurance accepted. No cops.

Located behind the Riot Club in {{randomDistrict}}.

Dr. Chrome — "If It Fits, It Ships"`,
  },
  {
    id: 'ripperdoc-02',
    category: 'ripperdoc',
    fromName: 'NovaCyber Clinic',
    fromEmail: 'appointments@novacyber.med',
    subject: 'Free Cyberware Diagnostic — This Weekend Only',
    body: `Feeling glitchy? Phantom limb feedback? Unexpected reboots?

NovaCyber Clinic is offering FREE cyberware diagnostic scans this weekend at our {{randomDistrict}} location. Our certified technicians will check all installed chrome for firmware issues, compatibility conflicts, and early signs of cyberpsychosis.

No appointment necessary. Walk-ins welcome Saturday and Sunday, 8am-6pm.

NovaCyber — Keeping Night City Connected.

*Diagnostic only. Repairs and replacements quoted separately. Results may be shared with Trauma Team for insurance purposes.`,
  },
  {
    id: 'ripperdoc-03',
    category: 'ripperdoc',
    fromName: 'Black Market Bionics',
    fromEmail: 'stock@bmb.darknet',
    subject: 'Fresh Stock — Militech Cyberarms, Factory Sealed',
    body: `New shipment just landed. All factory sealed, serial numbers intact (for now).

Available while supplies last:
- Militech Mantis Blades — 3,500 eb
- Dynalar Sandevistan Mk.2 — 5,000 eb  
- Zetatech Cyberdeck (military spec) — 4,200 eb

Installation available on-site. Anesthesia optional (200 eb extra).

Contact through usual channels. Reference code: BMB-{{currentDate}}

This message will self-corrupt in 24 hours.`,
  },
  {
    id: 'ripperdoc-04',
    category: 'ripperdoc',
    fromName: 'Dr. Ayumi Tanaka',
    fromEmail: 'clinic@tanaka-cyber.nc',
    subject: 'Cyberpsychosis Screening — Confidential & Affordable',
    body: `{{playerName}},

Early detection saves lives. If you or someone you know is experiencing increased aggression, dissociative episodes, or loss of empathy following recent cyberware installation, please consider scheduling a confidential screening.

Dr. Tanaka's clinic offers discreet cyberpsychosis risk assessments starting at 150 eb. All results are confidential and will NOT be reported to NCPD or MaxTac.

Located in {{randomDistrict}}. Evening appointments available.

You are not your chrome. You are more than the machine.

— Dr. Ayumi Tanaka, Certified Cyberpsychologist`,
  },
  {
    id: 'ripperdoc-05',
    category: 'ripperdoc',
    fromName: 'ChromeDoc Express',
    fromEmail: 'mobile@chromedoc.nc',
    subject: 'Mobile Ripperdoc — We Come To You',
    body: `Too hot to visit a clinic? Can't leave your safehouse? No problem.

ChromeDoc Express brings the chair to YOU. Our fully equipped mobile surgery van serves all Night City districts including {{randomDistrict}}.

Services include emergency repairs, firmware updates, basic installations, and bullet extraction (no questions asked).

Message us your location and we'll be there within the hour. Payment on completion. Discretion guaranteed.

ChromeDoc Express — "House Calls for the Chrome Age"`,
  },

  // ═══════════════════════════════════════════
  //  BRAINDANCE (5)
  // ═══════════════════════════════════════════

  {
    id: 'bd-01',
    category: 'braindance',
    fromName: 'XtremeXperience BD',
    fromEmail: 'new@xtremexp.bd',
    subject: 'New Drops: Feel What They Felt (18+ Only)',
    body: `This week's hottest scrolls just dropped.

Featured releases:
- "Freefall" — Base jump off Arasaka Tower (POV: the jumper)
- "Red Carpet" — Full sensory VIP experience at a corpo gala
- "Last Stand" — Combat BD from the 4th Corporate War (INTENSE)
- "Deep Blue" — Scuba dive in the Pacific, pre-pollution

All scrolls available in standard and premium (full emotional track) editions.

Download through your local BD vendor or message us for direct delivery to {{randomDistrict}}.

XtremeXperience — Live Someone Else's Life.

18+ ONLY. Some content may cause neural distress. XtremeXperience is not liable for psychological effects.`,
  },
  {
    id: 'bd-02',
    category: 'braindance',
    fromName: 'DreamWeaver Studios',
    fromEmail: 'subscribe@dreamweaver.bd',
    subject: 'DreamWeaver Premium — First Month Free',
    body: `Tired of reality? Subscribe to DreamWeaver Premium and escape into hundreds of curated braindance experiences.

Categories include: Adventure, Romance, Relaxation, Thriller, Historical, and our exclusive "Fantasy" collection.

Premium subscribers get:
- Unlimited streaming of our full catalog
- Early access to new releases
- Custom emotional intensity settings
- Ad-free experience

First month FREE, then just 29 eb/month. Cancel anytime.

DreamWeaver — Dream Bigger.`,
  },
  {
    id: 'bd-03',
    category: 'braindance',
    fromName: 'Underground BD Exchange',
    fromEmail: 'drops@ubdx.darknet',
    subject: 'Rare Scrolls — Limited Copies — Don\'t Ask Where',
    body: `New batch. You know the drill.

- Celebrity private moments (multiple subjects)
- Corporate boardroom recordings ({{randomCorpo}}, very recent)
- Combat scrolls from active conflict zones
- Custom "experience" recordings (you specify, we acquire)

Dead drops only. Payment in crypto or clean eddies. No refunds.

If you got this message, someone vouched for you. Don't make us regret it.

Reply with "INTERESTED" for pickup location.`,
  },

  // ═══════════════════════════════════════════
  //  POLITICAL (4)
  // ═══════════════════════════════════════════

  {
    id: 'political-01',
    category: 'political',
    fromName: 'Citizens for a Free Night City',
    fromEmail: 'resist@freenc.org',
    subject: 'The Corpos Own Your Mayor — Here\'s The Proof',
    body: `Night City deserves better.

Last week, {{randomCorpo}} donated 2.3 million eb to Mayor Rhyne's re-election campaign. The same week, three community health clinics in {{randomDistrict}} were defunded.

Coincidence? We have the receipts.

Join us at City Hall this Friday at noon. Bring your anger. Bring your neighbors. Leave your chrome at home — MaxTac has been spotted at recent rallies.

The streets belong to the people. It's time to take them back.

— Citizens for a Free Night City
"No More Corporate Puppets"`,
  },
  {
    id: 'political-02',
    category: 'political',
    fromName: 'Night City Progress Party',
    fromEmail: 'newsletter@ncpp.pol',
    subject: 'Vote YES on Proposition 14 — Cyberware Rights',
    body: `{{playerName}},

Proposition 14 would guarantee every Night City resident the right to basic cyberware maintenance, regardless of income or insurance status.

Currently, over 40% of Night City residents with installed cyberware cannot afford routine maintenance, leading to malfunctions, compatibility issues, and preventable cyberpsychosis cases.

Vote YES on Prop 14 in the upcoming municipal election.

Your chrome shouldn't be a death sentence just because you're poor.

— Night City Progress Party`,
  },
  {
    id: 'political-03',
    category: 'political',
    fromName: 'Humanity First Coalition',
    fromEmail: 'truth@humanityfirst.nc',
    subject: 'How Much Chrome Is Too Much? The Line Must Be Drawn.',
    body: `Every month, Night City loses another citizen to cyberpsychosis. Every month, MaxTac puts down someone who was once a father, a mother, a friend.

The corporations want you to buy more chrome. More implants. More upgrades. But at what cost to your humanity?

Humanity First advocates for reasonable cyberware limits, mandatory psych evaluations, and corporate accountability for cyberpsychosis caused by their products.

Join our community meeting in {{randomDistrict}} — every Wednesday at 7pm.

Remember: you are human first.`,
  },
  {
    id: 'political-04',
    category: 'political',
    fromName: 'NCPD Community Outreach',
    fromEmail: 'community@ncpd.gov',
    subject: 'Report Suspicious Activity — Earn Rewards',
    body: `The NCPD needs YOUR help keeping {{randomDistrict}} safe.

Our new Community Watch program rewards citizens who report criminal activity, gang operations, or suspicious behavior in their neighborhoods.

Rewards range from 50-500 eb depending on the quality and actionability of the information provided.

All tips are anonymous. Your identity is protected by Night City Municipal Code §22.1.

Report through the NCPD tip line or reply directly to this message.

NCPD — Protecting and Serving Night City.

*Reward payments subject to verification and conviction. NCPD reserves the right to modify reward amounts.`,
  },

  // ═══════════════════════════════════════════
  //  BLACK MARKET (5)
  // ═══════════════════════════════════════════

  {
    id: 'blackmarket-01',
    category: 'blackmarket',
    fromName: '████████',
    fromEmail: 'void@████.onion',
    subject: 'Militech Surplus — Fell Off a Convoy',
    body: `Got hardware you won't find on any shelf. Assault rifles, smart ammo, anti-vehicle mines. One-time deal.

Everything military-grade, everything hot. Prices negotiable for bulk orders.

Meet at the coordinates if interested. Come alone. Come armed (ironic, I know).

Coords sent via secure channel after reply. Reference: SURPLUS-{{currentDate}}

Don't forward this message. Don't screenshot this message. Don't be stupid.`,
  },
  {
    id: 'blackmarket-02',
    category: 'blackmarket',
    fromName: 'DataBroker',
    fromEmail: 'info@shadow.darknet',
    subject: 'Corporate Intel For Sale — {{randomCorpo}} Q4 Internals',
    body: `Fresh pull from {{randomCorpo}}'s internal servers. Includes:

- Executive communications (last 30 days)
- Project codenames and budgets
- Security rotation schedules
- Employee personal data (including home addresses)

Opening bid: 5,000 eb. Auction closes in 72 hours.

Serious buyers only. Verification of funds required before access.

This data has not been offered to competing corps yet. You have first look. Don't waste it.`,
  },
  {
    id: 'blackmarket-03',
    category: 'blackmarket',
    fromName: 'Pharmacy',
    fromEmail: 'rx@cleanmeds.darknet',
    subject: 'Pharma Drop — Syncomp, Speedheal, Black Lace',
    body: `Current inventory:

- Speedheal (genuine Trauma Team stock) — 100 eb/dose
- Syncomp Tablets (anti-rejection, 30-day supply) — 400 eb
- Bounce Back Mk.II — 75 eb/injector
- Stim Packs (military grade) — 50 eb/unit
- Black Lace — price on request

All pharma-grade, not street cut. Delivery available in {{randomDistrict}} and surrounding areas.

Bulk discounts for orders over 2,000 eb. Recurring customers get priority on limited stock.

Reply with order details. Dead drop locations provided after payment confirmation.`,
  },
  {
    id: 'blackmarket-04',
    category: 'blackmarket',
    fromName: 'Ghost',
    fromEmail: 'anon@void.net',
    subject: 'Clean IDs — New Identity, New Life',
    body: `Need to disappear? I can make it happen.

Services:
- Clean Night City ID (passes NCPD scanners) — 2,000 eb
- Full identity package (ID + credit history + employment records) — 5,000 eb
- Corporate employee credentials ({{randomCorpo}} available) — 8,000 eb
- Dead person's identity (untraceable) — 3,500 eb

Turnaround: 48-72 hours. Rush available for 50% surcharge.

I've been doing this for 15 years. Zero compromised clients. Zero.

Don't use your real name when you reply. Obviously.`,
  },
  {
    id: 'blackmarket-05',
    category: 'blackmarket',
    fromName: 'The Mechanic',
    fromEmail: 'garage@underground.nc',
    subject: 'Vehicle Mods — Off the Books, On the Road',
    body: `Your ride is boring. Let me fix that.

Current services:
- Armored plating installation (stops up to .50 cal)
- Concealed weapon mounts (trunk, door panels, bumper)
- Engine swap (Quadra V-Tech racing blocks in stock)
- Plate cloning (match any registered vehicle)
- Kill switch removal / anti-theft bypass

All work done in my private garage in {{randomDistrict}}. Appointment only.

NCPD vehicle inspections are a joke, but my work passes corpo-level scanners. Guaranteed.

Reply with vehicle make/model and desired work.`,
  },

  // ═══════════════════════════════════════════
  //  FIXER BAIT (4)
  // ═══════════════════════════════════════════

  {
    id: 'fixer-01',
    category: 'fixer',
    fromName: 'An Interested Party',
    fromEmail: 'opportunity@secure.net',
    subject: 'Need Reliable Operators — Discreet Work Available',
    body: `{{playerName}},

Your name came up in conversation. I hear you're someone who gets things done without making a mess.

I have work available. Nothing too complicated — pickup, delivery, maybe a conversation with someone who doesn't want to talk. Standard rates plus bonus for clean execution.

If you're interested, meet my associate at the Afterlife bar. Ask for "the Tuesday special." They'll know what it means.

No names. No records. No problems.`,
  },
  {
    id: 'fixer-02',
    category: 'fixer',
    fromName: 'Delta Services',
    fromEmail: 'jobs@deltasvcs.net',
    subject: 'Contract Available — {{randomDistrict}} — Quick Turnaround',
    body: `Active contract available in the {{randomDistrict}} area. Details:

Type: Asset retrieval
Difficulty: Moderate
Timeline: 48 hours
Pay: 2,500 eb (negotiable for experienced operators)

Requirements: Own transportation, basic combat proficiency, ability to work without supervision.

This is a legitimate business inquiry. All operators are independent contractors. Delta Services assumes no liability for injuries, property damage, or legal consequences.

Reply with your availability and relevant experience.`,
  },
  {
    id: 'fixer-03',
    category: 'fixer',
    fromName: 'Red Queen',
    fromEmail: 'queen@chessboard.nc',
    subject: 'Looking For A Knight — Premium Contract',
    body: `I don't send these messages to just anyone, {{playerName}}.

I have a situation that requires someone with specific talents. The kind of talents that don't show up on a resume. The pay reflects the risk — we're talking five figures for a weekend of work.

I can't say more over an open channel, even on {{networkName}}.

If you want to know more, be at the No-Tell Motel in Kabuki at midnight. Room 214. Knock twice, then once.

Come alone. Come ready.

— RQ`,
  },
  {
    id: 'fixer-04',
    category: 'fixer',
    fromName: 'Hiring Manager',
    fromEmail: 'recruit@merc-work.nc',
    subject: 'Merc Registry — Get Listed, Get Hired',
    body: `Tired of waiting for jobs to find you?

The Night City Mercenary Registry connects experienced operators with clients who need work done. Register your skills, set your rates, and let the contracts come to you.

Current demand is high for: netrunners, combat solos, stealth specialists, drivers, and medtechs.

Registration fee: 200 eb (one-time). Listings are anonymous — clients see your skills and ratings, never your real identity.

Over 500 contracts posted monthly across all Night City districts.

Reply with "REGISTER" to get started.`,
  },
];
