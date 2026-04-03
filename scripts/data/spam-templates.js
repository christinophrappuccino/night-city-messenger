/**
 * Built-in Spam Template Library
 * @file scripts/data/spam-templates.js
 * @module cyberpunkred-messenger
 * @description Pre-written Night City spam messages for the Time of the Red (2045).
 *              Set after the 4th Corporate War, Arasaka Tower nuke, DataKrash,
 *              and the collapse of the Old NET.
 *              Templates support variable tokens: {{playerName}}, {{networkName}},
 *              {{currentDate}}, {{randomCorpo}}, {{randomDistrict}}.
 *              GMs can create custom templates that mix into this pool.
 */

// ─── Flavor pools for {{randomCorpo}} and {{randomDistrict}} tokens ───

export const RANDOM_CORPOS = [
  'Biotechnica', 'Petrochem', 'Kang Tao', 'Danger Gal', 'Ziggurat',
  'Rocklin Augmentics', 'Militech', 'SovOil', 'Kendachi', 'Zhirafa',
  'Continental Brands', 'Network News 54', 'DMS', 'Lazarus Group',
  'Orbital Air', 'Trauma Team', 'Kiroshi', 'Raven Microcybernetics',
];

export const RANDOM_DISTRICTS = [
  'Watson', 'Westbrook', 'City Center', 'Heywood', 'Pacifica',
  'Santo Domingo', 'Kabuki', 'Japantown', 'Arroyo', 'Rancho Coronado',
  'Wellsprings', 'Charter Hill', 'Vista Del Rey', 'The Glen',
  'Northside Industrial', 'Coastview', 'Little China', 'Old Japantown',
  'the Combat Zone', 'South Night City',
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
    id: 'corpo-01', category: 'corpo',
    fromName: 'Biotechnica Wellness', fromEmail: 'health@biotechnica.corp',
    subject: 'Breathe Easy — Biotechnica Air Filters Now 30% Off',
    body: `{{playerName}},\n\nStill breathing unfiltered air in the Time of the Red? That red sky isn't just ugly — it's full of particulates from the Arasaka Tower blast zone that cause long-term cellular damage.\n\nBiotechnica Personal Air Filtration Units are clinically proven to reduce inhaled toxin exposure by 94%. Available in nasal implant, face mask, and whole-room purifier models.\n\nThis month only: 30% off all residential units. Because you can't make eddies if you can't breathe.\n\nBiotechnica — Growing the Future.\n\n*Biotechnica makes no claims regarding radiation exposure. Consult your local med-tech for rad screening.`,
  },
  {
    id: 'corpo-02', category: 'corpo',
    fromName: 'Trauma Team Subscriptions', fromEmail: 'subscribe@traumateam.nc',
    subject: "You Can't Afford NOT To Have Trauma Team",
    body: `How much is your life worth, {{playerName}}?\n\nLast month, 847 people flatlined in {{randomDistrict}} alone. Of those, 12 were Trauma Team subscribers. All 12 were extracted alive.\n\nBasic Plan: 500 eb/month — standard response, ground AV\nPremium Plan: 1,000 eb/month — priority response, armed escort\nExecutive Plan: 5,000 eb/month — instant response, full combat extraction\n\nThe Combat Zone is spreading. The cops don't come anymore. But WE do.\n\nSign up today. Mention code REDSKY45 for one free month.\n\nTrauma Team — Everyone Deserves a Second Chance.\n\n*Executive plan not available in the Hot Zone or within 2km of the Arasaka crater.`,
  },
  {
    id: 'corpo-03', category: 'corpo',
    fromName: 'Petrochem CHOOH2', fromEmail: 'fuel@petrochem.corp',
    subject: 'CHOOH2 Prices Dropping — Fill Up Now!',
    body: `Good news for Night City drivers!\n\nPetrochem has secured new CHOOH2 processing capacity at our South Night City refinery. Starting this week, pump prices drop to 3.50 eb/gallon at all Petrochem stations.\n\nPlus, join the Petrochem Fuel Club and earn 1 eb back for every 20 gallons. It adds up fast when you're running from gangers.\n\nFind your nearest Petrochem station in {{randomDistrict}} and all major districts.\n\nPetrochem — Fueling the Rebuilding.\n\n*Price valid at participating locations. Combat Zone stations may charge security surcharge. Armed guards on premises 24/7.`,
  },
  {
    id: 'corpo-04', category: 'corpo',
    fromName: '{{randomCorpo}} Careers', fromEmail: 'hiring@megacorp.net',
    subject: 'Corporate Security Positions — Immediate Hire',
    body: `{{randomCorpo}} is hiring armed security contractors for our {{randomDistrict}} campus.\n\nRequirements: Basic weapons training, clean(ish) record, no active gang affiliations, willing to work nights. Cyberware proficiency a plus but not required.\n\nPay: 600-900 eb/week. Includes company housing in a secured dormitory, three daily kibble rations, and basic med coverage.\n\nLook, we know it's not glamorous. But it's steady eddies, a roof that doesn't leak, and food that isn't literally garbage. In this economy? That's luxury.\n\nWalk-in interviews Monday through Friday, 0800-1600.\n\nThis is an automated message. Previous applicants need not reapply.`,
  },
  {
    id: 'corpo-05', category: 'corpo',
    fromName: 'Continental Brands', fromEmail: 'promo@continentalbrands.corp',
    subject: 'NEW — Kibble Premium Select™ Now In 3 Flavors!',
    body: `Tired of the same old kibble? So were we.\n\nIntroducing Kibble Premium Select™ — the first kibble product that actually tastes like something other than cardboard and regret.\n\nAvailable flavors:\n- Almost Chicken™\n- Vaguely Beef™\n- Definitely Not Fish™ (NEW!)\n\nEach box contains a full day's nutrition plus 15% more protein than standard kibble. Your body is rebuilding Night City. It deserves fuel that doesn't make you question your life choices.\n\nAvailable at all Continental Brands vendors and most Night Markets in {{randomDistrict}}.\n\nContinental Brands — Making Tomorrow Slightly More Edible.™`,
  },
  {
    id: 'corpo-06', category: 'corpo',
    fromName: 'Danger Gal Detective Agency', fromEmail: 'services@dangergal.nc',
    subject: 'Missing Someone? Danger Gal Can Find Them.',
    body: `In a city where people disappear daily, knowing is better than wondering.\n\nDanger Gal's professional investigators specialize in missing persons, cheating partners, background checks, and corporate counter-intelligence.\n\nWe've located over 3,000 missing persons since the end of the war. Some were alive. All were found.\n\nConsultation is free. Results are guaranteed or your eddies back.\n\nDanger Gal — The Truth Costs Less Than You Think.\n\nMain office: {{randomDistrict}}. Satellite offices citywide. All meetings confidential.`,
  },
  {
    id: 'corpo-07', category: 'corpo',
    fromName: 'Combat Cab Night City', fromEmail: 'rides@combatcab.nc',
    subject: "Combat Cab — Because Regular Taxis Don't Have Armor",
    body: `Going through the Combat Zone? Need a ride through {{randomDistrict}} after dark? Don't trust your life to some unlicensed gutter cab.\n\nCombat Cab vehicles feature:\n- Armored plating (stops up to 7.62mm)\n- Armed driver (all drivers are combat-certified)\n- Panic button with direct Trauma Team link\n- Dashcam recording for insurance purposes\n\nFlat rate to anywhere in Night City: 50 eb. Combat Zone surcharge: 25 eb. "We're getting shot at" surcharge: negotiable.\n\nDownload the Combat Cab app or just scream really loud near one of our vehicles.\n\nCombat Cab — We'll Get You There. Probably.™`,
  },
  {
    id: 'corpo-08', category: 'corpo',
    fromName: 'Orbital Air Vacations', fromEmail: 'escape@orbitalair.corp',
    subject: 'Leave Night City Behind — Crystal Palace Getaways',
    body: `{{playerName}}, when was the last time you saw a blue sky?\n\nThe Crystal Palace orbital station offers breathtaking views of Earth, zero-gravity relaxation, and most importantly — CLEAN AIR that doesn't taste like the Time of the Red.\n\nWeekend packages starting at just 75,000 eb. Includes shuttle transport, orbital suite, and complimentary dining.\n\nBecause you deserve a vacation from the apocalypse.\n\nOrbital Air — The Sky Is Only the Beginning.\n\n*Price does not include ground transportation to launch facility, re-entry insurance, or emergency evacuation coverage. Guests must sign death waiver before boarding.`,
  },

  // ═══════════════════════════════════════════
  //  SCAMS (8)
  // ═══════════════════════════════════════════

  {
    id: 'scam-01', category: 'scam',
    fromName: 'NC Reconstruction Lottery', fromEmail: 'winner@nclotto.net',
    subject: "WINNER!! You've Been Selected For 50,000 eb!",
    body: `Dear {{playerName}},\n\nCongratulations! Your agent ID was randomly selected in the Night City Reconstruction Lottery! You have won FIFTY THOUSAND EURODOLLARS!\n\nTo claim your prize, simply reply with your banking credentials and agent passcode. Processing takes 24-48 hours and a small verification fee of 200 eb.\n\nThis is totally real and not a scam. Would a scam email tell you it's not a scam? Exactly.\n\nACT NOW — unclaimed prizes are donated to the Arasaka Crater Beautification Fund.\n\nRef#: NCL-{{currentDate}}-REAL-HONEST`,
  },
  {
    id: 'scam-02', category: 'scam',
    fromName: 'Prince Emeka Adeyemi', fromEmail: 'prince@lagos-financial.net',
    subject: 'URGENT — Frozen Assets From Before The War',
    body: `Esteemed {{playerName}},\n\nI am Prince Emeka Adeyemi, nephew of the late Minister of Digital Commerce for the Nigerian Federal Republic. Before the DataKrash destroyed the Old NET, my uncle transferred 2.4 MILLION eurodollars to a secure offline vault.\n\nDue to international banking regulations in the post-war era, I require a Night City partner to access these funds. You will receive 40% of the total — nearly ONE MILLION eb — for your assistance.\n\nAll I require is a modest processing fee of 1,000 eb and your complete banking details.\n\nTime is of the essence. The vault access codes expire soon.\n\nWith warm regards,\nPrince Emeka Adeyemi\nLagos, 2045`,
  },
  {
    id: 'scam-03', category: 'scam',
    fromName: 'NCPD Automated Fines', fromEmail: 'fines@ncpd-collections.gov',
    subject: 'OUTSTANDING FINE — Pay Now Or Face Arrest',
    body: `NIGHT CITY POLICE DEPARTMENT — AUTOMATED NOTICE\n\nCitizen: {{playerName}}\nViolation: Unauthorized discharge of firearm in {{randomDistrict}}\nFine: 2,500 eb\n\nOur automated gunshot detection system logged a weapons violation at your registered location. Failure to pay within 48 hours will result in active warrant issuance, asset seizure, and potential MAX-TAC referral.\n\nPay immediately via secure transfer to avoid enforcement action.\n\nNote: If you believe this fine was issued in error, please visit your nearest NCPD precinct in person. Bring valid ID and wear something bulletproof.\n\nNCPD Automated Collections — THIS IS DEFINITELY A REAL GOVERNMENT EMAIL`,
  },
  {
    id: 'scam-04', category: 'scam',
    fromName: 'DataKrash Recovery Services', fromEmail: 'recovery@oldnet-salvage.com',
    subject: '⚠️ We Found Your Old NET Data — Recover It Now',
    body: `{{playerName}},\n\nOur data archaeologists have recovered a cache of Old NET data linked to your identity from before the DataKrash. This may include pre-war financial records, personal documents, old email archives, and cryptocurrency wallets potentially worth MILLIONS.\n\nFor a recovery fee of just 500 eb, we can restore your complete pre-DataKrash digital identity.\n\nAct fast — unsecured data fragments degrade every day. Once they're gone, they're gone forever.\n\nDataKrash Recovery Services — Rebuilding the NET, One File at a Time.\n\n*DataKrash Recovery Services is not affiliated with NetWatch, any government agency, or reality.`,
  },
  {
    id: 'scam-05', category: 'scam',
    fromName: 'Lucky 8 Pachinko Palace', fromEmail: 'jackpot@lucky8-nc.net',
    subject: "FREE 500 eb Credit — You've Been Pre-Approved!",
    body: `{{playerName}}, tonight's your lucky night!\n\nLucky 8 Pachinko Palace has pre-approved you for 500 eb in FREE gaming credits! No deposit, no catch, no kidding!\n\nWe also feature:\n- All-you-can-eat kibble buffet (Premium Select™!)\n- Live braindance lounge\n- "Definitely Legal" poker room\n- Armed security (for YOUR protection)\n\nJust reply with your agent ID to activate your account. Credits loaded instantly!\n\nLucky 8 Pachinko Palace — {{randomDistrict}}\n"Where Fortunes Are Made and Kneecaps Are Intact"\n\n*Must be 16+. Management not responsible for losses, theft, or sudden acts of violence on premises. House always wins.`,
  },
  {
    id: 'scam-06', category: 'scam',
    fromName: 'Agent Security Alert', fromEmail: 'alert@nc-cybersafe.net',
    subject: '⚠️ BREACH DETECTED — Your Agent Is Compromised',
    body: `URGENT SECURITY ALERT\n\n{{playerName}}, our monitoring system detected unauthorized access to your personal agent from an unknown device in {{randomDistrict}}.\n\nIf this was NOT you, your accounts, contacts, and eddies are at risk RIGHT NOW.\n\nClick below to verify your identity and secure your agent:\n[VERIFY IDENTITY IMMEDIATELY]\n\nYou must act within 12 hours or your agent will be permanently locked for your protection.\n\n— NC CyberSafe Security Division\n\n*This is an automated message. NC CyberSafe is a registered security company and definitely exists.`,
  },
  {
    id: 'scam-07', category: 'scam',
    fromName: 'Arasaka Reparations Board', fromEmail: 'claims@arasaka-reparations.org',
    subject: 'You May Be Entitled To Arasaka War Compensation',
    body: `Were you or a loved one affected by the Arasaka Tower detonation of 2023?\n\nThe Arasaka Reparations Board is processing claims from Night City residents impacted by the 4th Corporate War. Compensation packages range from 5,000 to 500,000 eb depending on proximity and damages.\n\nTo file your claim, reply with your full legal name, location during the Arasaka Tower incident, banking details for direct deposit, and a small filing fee of 750 eb.\n\nDon't wait — the filing deadline is approaching! Arasaka's money won't last forever!\n\n*The Arasaka Reparations Board is in no way affiliated with Arasaka Corporation, which does not acknowledge any liability. This is fine.`,
  },
  {
    id: 'scam-08', category: 'scam',
    fromName: 'NightCorp Timeshare', fromEmail: 'invest@nightcorp-living.net',
    subject: 'Own A Piece of the NEW Night City — Pre-Construction Pricing!',
    body: `The rebuilding is YOUR opportunity, {{playerName}}!\n\nNightCorp is developing luxury residential towers in the former Arasaka crater zone. Pre-construction units start at just 2,000 eb deposit!\n\nFeatures:\n- Radiation-shielded walls (probably)\n- Running water (most days)\n- Armed lobby guard (Monday through Friday)\n- Scenic views of the crater (it's actually kind of pretty at sunset)\n\nUnits will TRIPLE in value once the area is redeveloped! This is the ground floor of the next Night City real estate boom!\n\nReply now to lock in your unit. Only 14,000 units remaining!\n\n*Construction timeline is "optimistic." NightCorp is not liable for delays, structural failures, or residual radiation.`,
  },

  // ═══════════════════════════════════════════
  //  RIPPERDOC (7)
  // ═══════════════════════════════════════════

  {
    id: 'ripperdoc-01', category: 'ripperdoc',
    fromName: "Doc Chromejob's Bargain Bin", fromEmail: 'deals@chromejob.nc',
    subject: '⚡ Two-For-One Cyberarms — This Week Only!',
    body: `Lost a limb? Lost two? Doc Chromejob has you covered — LITERALLY.\n\nThis week's specials:\n- Cyberarms (basic model) — Buy one, get one FREE\n- Cybereyes (gently used) — 400 eb\n- Neural Link install — 800 eb (includes complimentary painkiller)\n- Subdermal Armor — 600 eb (ask about our "slightly dented" discount)\n\nWalk-ins welcome. Back entrance of the old Kabuki ramen shop. Knock twice, say "chrome me."\n\nAnesthesia is available for an extra 100 eb but honestly, most chooms just bite down on something.\n\nDoc Chromejob — "You Get What You Pay For, But At Least You GET Something"`,
  },
  {
    id: 'ripperdoc-02', category: 'ripperdoc',
    fromName: 'Rocklin Augmentics Authorized', fromEmail: 'service@rocklin-auth.nc',
    subject: 'Cyberware Recall Notice — Check Your Firmware',
    body: `IMPORTANT SERVICE NOTICE\n\nRocklin Augmentics has identified a firmware vulnerability in all RA-series cyberlimbs manufactured between 2042-2044. Affected units may experience:\n\n- Involuntary muscle spasms during sleep\n- Random grip strength spikes (crushing things you didn't mean to)\n- Occasional limb reboot during combat (EXTREMELY inconvenient)\n\nIf you have Rocklin Augmentics cyberware, visit any authorized service center for a FREE firmware update.\n\nAuthorized locations in {{randomDistrict}} and Watson. Bring your installation receipt if you still have it.\n\nRocklin Augmentics — Built to Last (After the Patch).`,
  },
  {
    id: 'ripperdoc-03', category: 'ripperdoc',
    fromName: "Dr. Yuki's After-Hours Clinic", fromEmail: 'discreet@dryuki.nc',
    subject: 'No Appointment, No ID, No Problem',
    body: `Need chrome installed off the books? Bullet removed without a police report? Dr. Yuki's clinic in {{randomDistrict}} is open after dark for clients who value PRIVACY.\n\nServices include:\n- Emergency surgery (gunshots, stabbings, "fell down stairs")\n- Chrome installation (no serial number checks)\n- Cyberware removal (don't ask, we won't either)\n- Post-combat patching (walk-ins only after midnight)\n- Humanity therapy consultation (new service!)\n\nPayment: eddies only. No insurance, no records, no questions.\n\nLocated behind the scop vendor on 4th Street. Look for the blue light.\n\nDr. Yuki — "Everyone Deserves Medical Care, Even You"`,
  },
  {
    id: 'ripperdoc-04', category: 'ripperdoc',
    fromName: 'CyberPsych Watch', fromEmail: 'help@cyberpsychwatch.nc',
    subject: 'Free Cyberpsychosis Screening — You Owe It To Your Chooms',
    body: `{{playerName}},\n\nInstalled new chrome recently? Feeling a little... detached? Getting angry at things that didn't used to bother you? Finding it hard to care about people?\n\nThese are early warning signs of cyberpsychosis. And catching it early is the difference between treatment and a MAX-TAC visit.\n\nCyberPsych Watch offers free, CONFIDENTIAL screenings every Saturday at community centers across Night City including {{randomDistrict}}. Results are NOT shared with NCPD, MAX-TAC, or your employer.\n\nYou don't have to become a statistic. Your chrome doesn't have to define you.\n\nWalk-ins welcome. Bring a friend — sometimes they notice before you do.\n\nCyberPsych Watch — Because Humanity Is Worth Fighting For`,
  },
  {
    id: 'ripperdoc-05', category: 'ripperdoc',
    fromName: 'MedTech Mobile', fromEmail: 'dispatch@medtechmobile.nc',
    subject: "Can't Get To A Doc? We'll Come To You.",
    body: `Street-side surgery, delivered.\n\nMedTech Mobile operates fully equipped medical vans serving all Night City districts. Too hot to visit a clinic? Hiding from someone? Just really lazy? We don't judge.\n\nServices:\n- Emergency first aid and stabilization\n- Bullet extraction (no report filed)\n- Basic chrome repair and firmware updates\n- Medication refills (legit prescriptions only... mostly)\n- Blood transfusions (synthetic, before you ask)\n\nResponse time: under 60 minutes in most districts. Combat Zone: we'll try, but no promises.\n\nPing us your location. Payment on completion. Tips appreciated — our drivers get shot at a lot.\n\nMedTech Mobile — "House Calls For The Cyberpunk Age"`,
  },
  {
    id: 'ripperdoc-06', category: 'ripperdoc',
    fromName: 'Implant Insurance Direct', fromEmail: 'quote@implantinsure.nc',
    subject: "Your Chrome Isn't Covered. That's A Problem.",
    body: `Quick question, {{playerName}}: if your cybereye glitches out tomorrow, can you afford to replace it?\n\nMost edgerunners can't. That's where Implant Insurance Direct comes in.\n\nFor as little as 50 eb/month, we cover:\n- Hardware failure and defects\n- Combat damage repair (yes, really)\n- Firmware corruption recovery\n- Theft replacement (chrome-jacking coverage)\n\nWe DON'T cover: intentional self-modification, black market install failures, damage from "holding a grenade too long," or anything that happens in the Combat Zone.\n\nGet a free quote today. Your chrome is your livelihood — protect it.\n\nImplant Insurance Direct — Because Warranty Expired Three Wars Ago`,
  },
  {
    id: 'ripperdoc-07', category: 'ripperdoc',
    fromName: 'The Chrome Dentist', fromEmail: 'smile@chromedentist.nc',
    subject: 'Cyberjaw Special — Bite Through Literally Anything',
    body: `Ever wished you could open a beer bottle with your teeth? What about a car door?\n\nThe Chrome Dentist now offers full cyberjaw installation at our {{randomDistrict}} clinic. Reinforced titanium mandible, self-sharpening molars, and optional venom gland housing.\n\nPackage deals:\n- Basic Cyberjaw: 1,200 eb (eats everything, judges nothing)\n- Combat Jaw: 2,500 eb (includes bite force amplifier)\n- "The Shark": 4,000 eb (retractable secondary row, very intimidating at parties)\n\nFree consultation. Financing available. We also do regular dental cleanings if you're boring.\n\nThe Chrome Dentist — "Making Night City Smile, One Titanium Tooth At A Time"`,
  },

  // ═══════════════════════════════════════════
  //  BRAINDANCE (5)
  // ═══════════════════════════════════════════

  {
    id: 'bd-01', category: 'braindance',
    fromName: 'Red Sky Recordings', fromEmail: 'drops@redskybd.nc',
    subject: 'NEW SCROLLS — War Archives, Combat BDs, More',
    body: `Fresh batch just dropped, chooms. This week's highlights:\n\n- "Tower Fall" — First-person recording from someone who was THERE when the bomb went off in '23. Heavily edited for safety. Still intense.\n- "Combat Zone Saturday" — Full uncut weekend in the Zone. You'll feel every bullet.\n- "Before The Red" — Nostalgia scroll of Night City in 2019. Blue skies. Clean air. Try not to cry.\n- "First Chrome" — What it feels like to get your first cyberarm installed. Popular with the chrome-curious crowd.\n\nStandard scrolls: 50 eb. Full emotional track: 100 eb. "Uncut" editions: don't ask the price in public.\n\nDead drops available in {{randomDistrict}}. Message for coordinates.\n\nRed Sky Recordings — Feel Something Real For Once.`,
  },
  {
    id: 'bd-02', category: 'braindance',
    fromName: 'DreamBox Subscriptions', fromEmail: 'escape@dreambox.bd',
    subject: 'DreamBox — First Week Free, Unlimited Scrolls',
    body: `Reality sucks. We checked. It definitely sucks.\n\nDreamBox is Night City's premiere braindance subscription service. One flat monthly rate, unlimited access to our full library of curated scrolls.\n\nCategories: Adventure, Romance, Relaxation, Food & Travel (remember those?), Historical, Sports, "Adult" (18+ verification required).\n\nMost popular scroll right now: "Sunday Morning" — a full sensory recording of waking up in a clean apartment, eating real eggs, and drinking actual coffee. Three hours of peace. People literally cry.\n\nFirst week FREE. Then 25 eb/month. Cancel anytime. Your brain deserves a vacation.\n\nDreamBox — Dream Better Than Reality.`,
  },
  {
    id: 'bd-03', category: 'braindance',
    fromName: 'Underground BD Exchange', fromEmail: 'scrolls@ubdx.darknet',
    subject: "Rare Stock — Things You Can't Get Anywhere Else",
    body: `New acquisitions. Serious collectors only.\n\n- Corporate boardroom recordings ({{randomCorpo}}, very recent, very juicy)\n- Pre-war celebrity scrolls (authentic, not reconstructed)\n- "Perspectives" series (same event, multiple viewpoints — you pick whose head you're in)\n- Custom commissioned scrolls (you describe it, we find someone living it)\n\nNo snuff. No minors. We have standards. Low standards, but standards.\n\nDead drops only. Clean eddies or trade. We know what the fakes look like so don't try it.\n\nIf you got this message, somebody vouched for you. Don't share it. Don't screenshot it. Don't be that guy.\n\nReply: "INTERESTED" — we'll send pickup coordinates.`,
  },
  {
    id: 'bd-04', category: 'braindance',
    fromName: 'Holo-Arcade', fromEmail: 'play@holoarcade.nc',
    subject: 'Grand Opening — Braindance Arcade in {{randomDistrict}}!',
    body: `Why watch braindance alone in your coffin apartment when you can do it in a SLIGHTLY LARGER room with other people?\n\nHolo-Arcade is Night City's newest braindance entertainment center! Drop in, plug in, zone out.\n\nFeatures:\n- 40 private BD booths (sanitized between uses, mostly)\n- Group viewing room (share scrolls with your crew)\n- Competitive BD gaming (race scrolls, combat challenges)\n- Snack bar (Premium Select™ kibble and synthetic beer)\n\nGrand opening special: first hour FREE! Located in {{randomDistrict}}, next to the old laundromat.\n\nHolo-Arcade — Plug In. Tune Out. Forget Your Problems Exist.\n\n*Management not responsible for BD addiction, residual emotional effects, or seizures. Maximum 4-hour sessions enforced by auto-disconnect.`,
  },
  {
    id: 'bd-05', category: 'braindance',
    fromName: 'BD Anonymous', fromEmail: 'support@bdanon.nc',
    subject: "Scrolling Too Much? You're Not Alone.",
    body: `It starts with one scroll to relax after work. Then two. Then you're skipping meals to stay plugged in because the braindance world is better than the real one.\n\nIf this sounds familiar, BD Anonymous can help.\n\nWe meet every Wednesday at the community center in {{randomDistrict}}. No judgment, no lectures. Just chooms who understand what it's like when the scrolls feel more real than your life.\n\nFirst step is showing up. We saved you a seat.\n\nBD Anonymous — Your Real Life Is Worth Living Too.\n\n*All meetings are confidential. Light refreshments provided (real coffee, not synth).`,
  },

  // ═══════════════════════════════════════════
  //  POLITICAL (5)
  // ═══════════════════════════════════════════

  {
    id: 'political-01', category: 'political',
    fromName: 'Rebuild Night City Coalition', fromEmail: 'resist@rebuildnc.org',
    subject: 'The Corpos Destroyed This City. Now They Want To Own The Rebuilding.',
    body: `22 years since the bomb. 22 years of red skies and broken promises.\n\nAnd now {{randomCorpo}} wants to "rebuild" {{randomDistrict}}? The same corps that turned our city into a warzone are buying up the rubble for pennies.\n\nThe Rebuild Night City Coalition is fighting for community-controlled reconstruction. YOUR neighborhood, YOUR decisions, YOUR future.\n\nRally at City Hall this Friday. Bring your anger. Bring your neighbors. Bring bottled water because the public fountains don't work.\n\nWe lost the war, but we don't have to lose the peace.\n\n— Rebuild Night City Coalition\n"This Is OUR City"`,
  },
  {
    id: 'political-02', category: 'political',
    fromName: 'Citizens Against MAX-TAC', fromEmail: 'truth@abolishmaxtac.nc',
    subject: 'MAX-TAC Killed 14 People Last Month. Only 3 Were Cyberpsychos.',
    body: `They call it "Cyberpsychosis Response." We call it state-sponsored murder.\n\nLast month, MAX-TAC conducted 22 operations in Night City. 14 fatalities. Internal records show only 3 subjects exhibited confirmed cyberpsychosis symptoms. The other 11 were classified as "potential threats."\n\nPotential threats. That's corpo-speak for "we shot first and didn't bother asking questions."\n\nIf you've lost someone to MAX-TAC, if you're tired of militarized cops executing citizens without trial, join us.\n\nPublic forum: Thursday nights, 7pm, {{randomDistrict}} community center.\n\nCitizens Against MAX-TAC — Because "Potential Threat" Shouldn't Be a Death Sentence`,
  },
  {
    id: 'political-03', category: 'political',
    fromName: 'NCPD Community Watch', fromEmail: 'tips@ncpd-community.gov',
    subject: 'See Something? Earn Something. Report Crime For Eddies.',
    body: `The NCPD needs YOUR eyes and ears to keep {{randomDistrict}} safe.\n\nOur Community Watch tipline pays between 50-500 eb for actionable intelligence on criminal activity, boostergang operations, and illegal weapons caches.\n\nAll tips are anonymous. Probably. We're pretty sure the system works. The tech guy said it's encrypted.\n\nRecent payouts: boostergang hideout location (300 eb), illegal ripperdoc operating without license (100 eb), "my neighbor is definitely building something in his garage" (50 eb, turned out to be a bookshelf).\n\nNCPD — Protecting Night City*\n\n*Protection not guaranteed in the Combat Zone, Hot Zone, or after 11pm.`,
  },
  {
    id: 'political-04', category: 'political',
    fromName: 'Nomad Rights Alliance', fromEmail: 'road@nomadalliance.nc',
    subject: "Nomads Built This City's Supply Lines. Time They Got Respect.",
    body: `Without Nomad convoys, Night City starves. Without Nomad mechanics, your cars don't run. Without Nomad traders, half the Night Markets close.\n\nBut when was the last time the city government did ANYTHING for the people who keep this city alive?\n\nThe Nomad Rights Alliance is pushing for:\n- Legal protections for Nomad traders within city limits\n- Designated safe parking areas (not the radioactive lots by the docks)\n- Healthcare access for Nomad families\n- An end to NCPD harassment of convoy crews\n\nSupport the people who feed your city. Attend our awareness event this weekend.\n\nNomad Rights Alliance — "The Road Keeps Night City Alive"`,
  },
  {
    id: 'political-05', category: 'political',
    fromName: 'Humanity First NC', fromEmail: 'human@humanityfirst.nc',
    subject: "How Much Chrome Is Too Much? The Question Nobody Wants To Ask.",
    body: `Every week, another cyberpsychosis incident. Every week, MAX-TAC rolls out. Every week, the ripperdocs install more chrome in more people.\n\nWe're not anti-technology. We're pro-HUMAN. There's a difference.\n\nHumanity First advocates for:\n- Mandatory psych screenings before major cyberware installation\n- Corporate liability for cyberpsychosis caused by their products\n- More funding for therapy alternatives to chrome\n- Honest public education about Humanity Loss\n\nFree community meetings every Tuesday in {{randomDistrict}}. All welcome — even if you're fully chromed. ESPECIALLY if you're fully chromed.\n\nHumanity First — "The Machine Doesn't Define You"`,
  },

  // ═══════════════════════════════════════════
  //  BLACK MARKET (6)
  // ═══════════════════════════════════════════

  {
    id: 'blackmarket-01', category: 'blackmarket',
    fromName: '████████', fromEmail: 'void@████.onion',
    subject: 'War Surplus — Fell Off A Militech Convoy',
    body: `Got hardware that "officially" doesn't exist anymore. 4th Corp War surplus, mint condition, still in the original crate.\n\nCurrent inventory:\n- Militech Ronin light assault rifle (x8)\n- Incendiary grenades (case of 20)\n- Militech-issue body armor (stops rifle rounds, probably)\n- Smart ammo (limited supply, compatible with most smart weapons)\n\nPrices negotiable for bulk. Trade accepted (chrome, drugs, favors).\n\nMeet at the coordinates after reply confirmation. Come alone. If you bring friends, we have friends too. Ours are better armed.\n\nReference: SURPLUS-{{currentDate}}\n\nThis message self-corrupts in 12 hours. Not really, but it sounds cool.`,
  },
  {
    id: 'blackmarket-02', category: 'blackmarket',
    fromName: 'The Pharmacist', fromEmail: 'rx@cleanmeds.darknet',
    subject: 'Fresh Pharma Drop — Speedheal, Stims, & More',
    body: `Current stock, all pharmaceutical-grade (NOT street-cut):\n\n- Speedheal: 80 eb/dose (genuine Trauma Team supply chain)\n- Bounce Back: 60 eb/injector\n- Stim Packs: 40 eb/unit (military issue)\n- Syncomp-15 (anti-rejection, 30-day supply): 350 eb\n- Antibiotic Boosters: 25 eb/course\n- Black Lace: ████ (if you know, you know)\n\nDelivery available in {{randomDistrict}} and adjacent districts. Bulk discounts over 2,000 eb. Regulars get priority on limited stock.\n\nDead drop protocol after payment confirmation. Don't meet me in person. That's not how this works. That's never how this works.`,
  },
  {
    id: 'blackmarket-03', category: 'blackmarket',
    fromName: 'Ghost', fromEmail: 'nobody@void.nc',
    subject: 'New Identity, New Life — 48 Hours Flat',
    body: `Need to not be you anymore? I understand. Night City is full of reasons to start over.\n\nServices:\n- Clean Night City ID (passes NCPD scanners): 2,000 eb\n- Full identity package (ID, credit history, work records): 5,000 eb\n- {{randomCorpo}} employee credentials: 8,000 eb\n- Dead person's identity (genuinely untraceable): 3,500 eb\n- Nomad clan papers (any family, they won't check): 1,500 eb\n\nTurnaround: 48-72 hours. Rush service: 50% surcharge.\n\n15 years in business. Zero clients discovered. ZERO.\n\nDon't use your real name when you reply. I know that sounds obvious but you'd be amazed.`,
  },
  {
    id: 'blackmarket-04', category: 'blackmarket',
    fromName: 'DataBroker', fromEmail: 'intel@shadow.darknet',
    subject: 'Corporate Intel — {{randomCorpo}} — Fresh Pull',
    body: `Just pulled data from {{randomCorpo}}'s local NET architecture. Their ICE was laughable.\n\nPackage includes:\n- Internal communications (last 45 days)\n- Security rotation schedules for {{randomDistrict}} campus\n- Employee records with home addresses\n- Project codenames and budget allocations\n- Executive travel itineraries\n\nOpening price: 5,000 eb. Exclusive access for 72 hours — after that I shop it to competitors.\n\nThis data is verified clean. No tracker payloads, no corporate honeypot. I have a reputation to maintain.\n\nSerious buyers only. Proof of funds required before sample access.`,
  },
  {
    id: 'blackmarket-05', category: 'blackmarket',
    fromName: 'Gearhead', fromEmail: 'garage@underground.nc',
    subject: 'Vehicle Mods — No Questions, All Answers',
    body: `Your ride is stock. That's embarrassing.\n\nWhat I do:\n- Armor plating (stops up to .50 cal, looks factory)\n- Concealed weapon mounts (trunk, doors, bumper-mounted)\n- Engine swap (CHOOH2 racing blocks, doubles your horsepower)\n- Run-flat tires (because someone WILL shoot your tires)\n- Plate cloning (be any vehicle you want on camera)\n- Police scanner integration (know where they are before they know where you are)\n- Ejection seat (not kidding, installed three last month)\n\nPrivate garage in {{randomDistrict}}. By appointment only. Don't bring cops. Don't be cops. Don't look like cops.\n\nGearhead — "Making Night City's Fastest Rides Even Faster"`,
  },
  {
    id: 'blackmarket-06', category: 'blackmarket',
    fromName: 'The Architect', fromEmail: 'secure@architect.darknet',
    subject: 'Safehouses Available — Monthly Rental',
    body: `Need a place to lay low? I maintain a network of secure safehouses across Night City.\n\nEvery safehouse includes:\n- Reinforced door (breaching charge resistant)\n- Independent power supply (off the city grid)\n- Clean water and 30-day food supply\n- Basic medical kit and one firearm\n- Backup identity documents (generic)\n- Panic tunnel or fire escape\n\nLocations available in Watson, Heywood, and {{randomDistrict}}.\n\nMonthly rental: 500-1,500 eb depending on location and amenities. No questions about why you need it. No records of who's inside.\n\n"Emergency" availability (right now, tonight, I'm literally running): 200 eb surcharge.\n\nThe Architect — "Everyone Needs A Backdoor"`,
  },

  // ═══════════════════════════════════════════
  //  FIXER BAIT (6)
  // ═══════════════════════════════════════════

  {
    id: 'fixer-01', category: 'fixer',
    fromName: 'An Interested Party', fromEmail: 'work@secure.net',
    subject: "Your Name Came Up. That's Either Good or Bad.",
    body: `{{playerName}},\n\nSomeone I trust said you're reliable. In Night City, that's worth more than chrome.\n\nI have work available. Nothing too wild — pickup, delivery, maybe a conversation with someone who's been avoiding their obligations. Standard rates. Bonus for clean work. Big bonus for quiet work.\n\nInterested? Afterlife bar. Ask the bartender about "Tuesday's special." They'll point you to my associate.\n\nNo agent names. No real addresses. No records. The kind of work where the less you know going in, the better you sleep after.\n\nOr don't come. Plenty of edgerunners in Night City. But not plenty of RELIABLE ones.`,
  },
  {
    id: 'fixer-02', category: 'fixer',
    fromName: 'Delta Work Services', fromEmail: 'contracts@deltawork.net',
    subject: 'Contract: {{randomDistrict}} — 48hr Turnaround',
    body: `Active contract, immediate start.\n\nDETAILS:\n- Type: Asset retrieval\n- Location: {{randomDistrict}} area\n- Timeline: 48 hours maximum\n- Opposition: Expected, non-corporate (probably gang-related)\n- Pay: 2,500 eb (negotiable for experienced operators)\n\nREQUIREMENTS:\n- Own transportation\n- Combat proficiency\n- Ability to work unsupervised without shooting everything\n\nThis is a legitimate independent contractor engagement. Delta Work Services assumes zero liability for injuries, property damage, death, or anything else that happens once you accept. Standard boilerplate.\n\nReply with availability and a brief summary of why we should pick you over the other 40 chooms who got this message.`,
  },
  {
    id: 'fixer-03', category: 'fixer',
    fromName: 'Red Queen', fromEmail: 'queen@chessboard.nc',
    subject: 'I Need A Knight. The Pay Reflects The Risk.',
    body: `{{playerName}},\n\nI don't mass-mail these. You specifically were recommended by someone whose judgment I trust. Don't make me regret it.\n\nI have a situation. The kind that requires a particular set of skills and a flexible relationship with the law. The pay is five figures. The timeline is one weekend. The details are not for an open channel, even on {{networkName}}.\n\nIf you're interested — and you should be — show up at the Forlorn Hope bar tomorrow at midnight. Sit at the bar. Order a whiskey neat. Someone will make contact.\n\nCome alone. Come prepared. Leave your ego at the door.\n\n— RQ\n\nP.S. If this message gets forwarded to anyone, our business relationship ends before it begins. Along with some other things.`,
  },
  {
    id: 'fixer-04', category: 'fixer',
    fromName: 'Night City Merc Registry', fromEmail: 'register@mercwork.nc',
    subject: 'Get Listed. Get Hired. Get Paid.',
    body: `Still finding work through word of mouth? That's cute. It's also 2045.\n\nThe Night City Merc Registry connects operators with clients who need things done. Register your skills, set your rates, build your reputation, and let the contracts find YOU.\n\nCurrently in demand: netrunners (always), solo operators, stealth specialists, getaway drivers, medtechs, and "people who are good at talking to people who don't want to talk."\n\nRegistration: 200 eb one-time fee. Your listing is anonymous — clients see skills and ratings, never real names.\n\nOver 300 contracts posted monthly. The good ones go fast, so check daily.\n\nNight City Merc Registry — "Freelance Violence, Professionally Managed"`,
  },
  {
    id: 'fixer-05', category: 'fixer',
    fromName: 'Honest Work, LLC', fromEmail: 'jobs@honestwork.nc',
    subject: 'Bodyguard Work Available — Short Term, Good Pay',
    body: `Client needs personal security for a business meeting in {{randomDistrict}} next Tuesday.\n\nSpecifics:\n- Duration: 4-6 hours\n- Dress code: professional (no visible weapons... concealed is fine)\n- Pay: 800 eb flat\n- Risk level: "probably nothing but you never know"\n\nClient is a mid-level corpo type who's nervous about a meeting with people they owe money to. They mainly need someone intimidating standing behind them looking like they could ruin someone's day.\n\nIf you're tall, well-chromed, and good at looking menacing without actually having to do anything — this is easy money.\n\nReply with a photo and your hourly rate. Meeting location provided day-of.`,
  },
  {
    id: 'fixer-06', category: 'fixer',
    fromName: 'The Cleaner', fromEmail: 'aftermath@cleanup.darknet',
    subject: 'Things Got Messy? I Make Messes Disappear.',
    body: `Hypothetically speaking, if someone had a situation that required... tidying up... I'm the person to call.\n\nServices:\n- Scene sanitization (biological and ballistic evidence removal)\n- Vehicle disposal (into the bay, crushed, or "exported")\n- Digital trail removal (security camera footage, GPS logs)\n- Witness relocation assistance (voluntary or otherwise)\n- Alibi construction (I have friends in many places)\n\nI don't need to know what happened. I don't want to know what happened. I just need to know WHERE and HOW SOON.\n\n24/7 availability. Night City-wide coverage. Payment upfront, non-negotiable.\n\nThe Cleaner — "It Never Happened"\n\n*This message is a work of fiction for entertainment purposes. Any resemblance to actual criminal services is purely coincidental.`,
  },
];
