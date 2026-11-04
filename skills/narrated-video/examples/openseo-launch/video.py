# The OpenSEO launch video (1:54, from Ben's take "Launch take", light edit): six scenes over real screenshots of the app,
# every cue timed to the narration. The worked example for the narrated-video skill.
#   cd <work folder>; NV_SCRIPTS=<skill>/scripts ASSETS=<captures folder> uv run --with numpy python video.py   -> comp/
# Reads the take folder (edl.json, words.json, narration-edit.wav); the captures are not in this repo. Every cue position
# below (the times passed to onset() and word()) fits this edit only: copy the structure, re-anchor every cue, and read
# the cue table this prints after any change to the edit.
import os, sys
sys.path.insert(0, os.environ.get('NV_SCRIPTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts')))
import compose as C
from cues import Cues

ASSETS = os.environ.get('ASSETS', 'assets')
TAKE = os.environ.get('TAKE', 'takes/final')
cu = Cues(TAKE)
w, onset = cu.word, cu.onset
EX = dict(cp='atlys.com', kw='ai visa assistant', kmt='visa services')   # typed on screen: one capture per keystroke
A = dict(
    # Cue times: a word's start from the cue sheet (w), or the exact voice onset after a point in the pause before it.
    app=onset(7.4), app_mcp=w('mcp'), app_ui=w('ui'), app_data=w('data', 13.5), app_agent=w('agent', 15.0),
    cp=onset(19.13), cp_field=w('input', 23.0), cp_input=w("competitor's"), cp_keywords=w('keywords', 29.0),
    cp_pages=w('top', 31.5), cp_strategy=w('strategy'),
    kw=onset(38.0), kw_tool=w('research', 40.5), kw_idea=w('batch'), kw_ai=w('ai', 47.5), kw_ten=w('10'),
    kw_vs=w('visa', 55.95), kw_list=w('bunch', 60.0), kw_target=w('hey'),
    feat=onset(74.55), feat_features=w('features', 74.5), feat_anything=w('anything', 76.0),
    feat_technical=w('technical'), feat_site=w('site', 80.0), feat_but=w('but', 82.0), feat_set=w('set', 85.0),
    feat_agent=w('agent', 85.5),
    aip=onset(86.95), setup_copy=w('copy'), setup_agent=w('into', 88.0), setup_claude=w('claude'),
    setup_chatgpt=onset(89.3), setup_grok=onset(90.97), setup_done=w('set', 91.8), skills_use=w('skills', 94.0),
    skills_which=w('which', 94.8), skills_great=w('great', 95.8), skills_kw=w('keyword', 100.0),
    skills_audit=w('seo', 101.8),
    end=onset(104.3), end_last=w('bye') + 0.5)
A = {k: round(v, 3) for k, v in A.items()}
cu.show(A)
# Scene starts: 0.3 s before a scene's first word, except where the narration was cut in the pause before it (keyword
# ideas, more features, the end card): there the scene starts on the cut, so the webcam's jump lands on the scene change.
T = C.timing({'db': 0.0, 'cp': A['cp'] - 0.3, 'kw': cu.cuts[1], 'feat': cu.cuts[2], 'aip': A['aip'] - 0.3, 'end': cu.cuts[3]},
             total=C.f30(A['end_last'] + 1.8))

c = lambda *n: [f'cv/{x}.png' for x in n]                                  # captures of the app for the Veeza example
seq = lambda p, a, b: [f'cv/{p}-{n:02d}.png' for n in range(a, b + 1)]   # typing frames p-00, p-01, ...
pg = lambda name: [f'v/{name}.png']                                       # data pages
cam, url = C.camera, 'app.openseo.so'
secs = [
    C.backdrop(T, 'bg-sea2.png'),
    C.scene('db', T, C.canvas('db', cam('db-o', 'db-i', c('db', 'cp-00'))), C.label('lb-db', 'A quick tour of OpenSEO'), url),
    C.scene('cp', T, C.canvas('cp', cam('cpf-o', 'cpf-i', seq('cp', 0, 1 + len(EX['cp']))),
                              cam('cp-o', 'cp-i', pg('12-domain-overview-tall'), tall=2400, hidden=True),
                              cam('cpp-o', 'cpp-i', pg('12b-domain-toppages'), hidden=True)), C.label('lb-cp', 'Research competitors'), url),
    C.scene('kw', T, C.canvas('kw', cam('kwf-o', 'kwf-i', seq('kw', 0, 1 + len(EX['kw']))),
                              cam('kw-o', 'kw-i', pg('14-keywords-tall'), tall=2400, hidden=True),
                              cam('kmt-o', 'kmt-i', seq('kmt', 0, 2 + len(EX['kmt'])), hidden=True),
                              cam('kmc-o', 'kmc-i', pg('14c-kw-mc'), hidden=True)), C.label('lb-kw', 'Get keyword ideas'), url),
    C.scene('feat', T, C.canvas('feat', cam('ft-o', 'ft-i', pg('18-audit-issues'))),
            C.label('lb-feat', 'And much more') + C.label('lb-feat2', 'Audit your site'), url),
    C.scene('aip', T, C.canvas('aip', cam('aip-o', 'aip-i', c('aip-0', 'aip-1')), cam('aps-o', 'aps-i', c('aip-skills'), hidden=True)),
            C.label('lb-aip', 'Copy the setup prompt') + C.label('lb-aip2', 'Paste it into your agent') + C.label('lb-aip3', 'Ready-made SEO skills'), url),
    C.end_card(T, 'og.png'),
    C.cam_slot(T),
]
CHOREO = r"""
  // 1 Dashboard (the first frame is the poster): the whole app, a push into the checklist on "I mostly use OpenSEO";
  //   the sidebar's pages on "looking at the UI", the pointer running down them through "the data that we provide for
  //   your agent"; then Explore a competitor is clicked into the next scene.
  setFrame('#db-o', '#db-i', [0, 0, W, H]);
  moveTo('#db-o', '#db-i', [330, 85, 1022, 532], 1.0, A.app - 1.2, 'sine.inOut', 1.3);
  moveTo('#db-o', '#db-i', [0, 170, 380, 560], A.app_ui - 1.6, 1.2, 'power2.inOut', 1.6);
  cAt('#db-i', 640, 640, 0); cShow('#db-i', A.app_ui - 1.3, 0.3);
  cMove('#db-i', 110, 266, A.app_ui - 1.2, 0.8);
  cMove('#db-i', 110, 394, A.app_data - 0.5, 1.0);
  cMove('#db-i', 110, 558, A.app_agent - 0.5, 1.0);
  drift('#db-i', 16, A.app_ui - 0.4, E('db') - 1.4 - (A.app_ui - 0.4));
  moveTo('#db-o', '#db-i', [330, 85, 1022, 532], E('db') - 1.4, 0.9, 'power2.inOut', 1.3);
  cMove('#db-i', 472, 212, E('db') - 1.3, 0.8); cClick('#db-i', 472, 212, E('db') - 0.35); showFrame('#db-i-1', E('db') - 0.3);
  label('#lb-db', 0.5, 5.6);
  out('db', 0.2);

  // 2 Competitor research: the competitor form while it is introduced; the field clicked on "input any website";
  //   atlys.com typed on "a competitor's website", Explore competitor; the keywords on "what keywords they rank for";
  //   the Top Pages tab on "top performing pages"; its URLs on "inform your strategy".
  setFrame('#cpf-o', '#cpf-i', [330, 85, 1022, 640], 1.18);
  fadeIn('#cpf-o', S.cp, 0.25);
  moveTo('#cpf-o', '#cpf-i', [330, 150, 700, 330], S.cp + 0.4, A.cp_field - 1.0 - (S.cp + 0.4), 'sine.inOut', 1.6);
  drift('#cpf-i', 14, A.cp_field - 1.0, A.cp_input + 1.3 - (A.cp_field - 1.0));
  cAt('#cpf-i', 472, 212, 0); cShow('#cpf-i', S.cp + 0.1, 0.2);
  cMove('#cpf-i', 430, 380, A.cp_field - 0.9, 0.6); cClick('#cpf-i', 430, 380, A.cp_field - 0.2); showFrame('#cpf-i-1', A.cp_field - 0.15);
  typeFrames('#cpf-i', 2, 1 + TYPED.cp, A.cp_input, 0.06);
  cMove('#cpf-i', 425, 432, A.cp_input + 0.65, 0.3); cClick('#cpf-i', 425, 432, A.cp_input + 1.05);
  setFrame('#cp-o', '#cp-i', [265, 300, 1150, 560], 1.15, 2400);
  show('#cp-o', A.cp_input + 1.15, 0.3);
  moveTo('#cp-o', '#cp-i', [265, 470, 1150, 420], A.cp_keywords - 0.4, 1.1, 'power2.inOut', 1.15, 900);   // framed as the 900-tall Top Pages shot
  cAt('#cp-i', 700, 620, 0); cShow('#cp-i', A.cp_keywords - 0.3, 0.25);
  cMove('#cp-i', 339, 488, A.cp_keywords - 0.25, 0.8);
  cMove('#cp-i', 442, 488, A.cp_pages - 0.8, 0.4); cClick('#cp-i', 442, 488, A.cp_pages - 0.3);
  setFrame('#cpp-o', '#cpp-i', [265, 470, 1150, 420], 1.15);
  show('#cpp-o', A.cp_pages - 0.2, 0.25);
  cAt('#cpp-i', 442, 488, 0); cOn('#cpp-i', A.cp_pages - 0.2);
  cHide('#cpp-i', A.cp_pages + 0.9);
  drift('#cpp-i', 12, A.cp_pages + 0.1, A.cp_strategy - 0.4 - (A.cp_pages + 0.1));
  moveTo('#cpp-o', '#cpp-i', [265, 580, 760, 300], A.cp_strategy - 0.4, 1.2, 'power2.inOut', 1.6);
  drift('#cpp-i', 16, A.cp_strategy + 0.85, E('cp') - A.cp_strategy - 1.15);
  label('#lb-cp', S.cp + 0.35, S.cp + 4.2);
  out('cp');

  // 3 Keyword ideas: the keyword form on "this keyword research feature"; the seed field clicked on "another company";
  //   "ai visa assistant" typed as it is said, Get keyword ideas; "Vol 10" on "10 searches", held through
  //   "in the United States"; "visa services" typed into the search box as "but visa services" is said, Search; "Vol
  //   2,400" on "2,000 searches"; the list of ideas on "a bunch of ideas"; closer rows on "hey, this is the kind of content".
  setFrame('#kwf-o', '#kwf-i', [330, 88, 1022, 420], 1.3);
  fadeIn('#kwf-o', S.kw);
  drift('#kwf-i', 12, S.kw + 0.3, A.kw_tool - 0.4 - (S.kw + 0.3));
  moveTo('#kwf-o', '#kwf-i', [340, 330, 560, 130], A.kw_tool - 0.4, 1.2, 'power2.inOut', 2.0);
  drift('#kwf-i', 10, A.kw_tool + 0.8, A.kw_idea + 0.35 - (A.kw_tool + 0.8));
  cAt('#kwf-i', 780, 300, 0); cShow('#kwf-i', A.kw_idea - 1.2, 0.3);
  cMove('#kwf-i', 430, 380, A.kw_idea - 1.1, 0.8); cClick('#kwf-i', 430, 380, A.kw_idea); showFrame('#kwf-i-1', A.kw_idea + 0.05);
  drift('#kwf-i', 14, A.kw_idea + 0.4, A.kw_ai - A.kw_idea - 0.8, 'x');
  typeFrames('#kwf-i', 2, 1 + TYPED.kw, A.kw_ai - 0.05, 0.05);
  cMove('#kwf-i', 425, 432, A.kw_ai + 0.85, 0.25); cClick('#kwf-i', 425, 432, A.kw_ai + 1.2);
  setFrame('#kw-o', '#kw-i', [265, 300, 1150, 560], 1.15, 2400);
  show('#kw-o', A.kw_ai + 1.3, 0.3);
  moveTo('#kw-o', '#kw-i', [265, 315, 480, 55], A.kw_ten - 0.6, 0.9, 'power3.out', 2.2, 2400);
  cAt('#kw-i', 700, 560, 0); cShow('#kw-i', A.kw_ten - 0.5, 0.25); cMove('#kw-i', ...VOL_PT, A.kw_ten - 0.45, 0.7);
  cHide('#kw-i', A.kw_ten + 0.9);
  const t0 = A.kw_vs - 0.6, typedEnd = t0 + 0.55 + TYPED.kmt * 0.05;
  drift('#kw-i', 10, A.kw_ten + 0.3, t0 - 0.6 - (A.kw_ten + 0.3), 'x');
  moveTo('#kw-o', '#kw-i', [300, 100, 1110, 280], t0 - 0.6, 0.6, 'power2.inOut', 1.3, 2400);
  setFrame('#kmt-o', '#kmt-i', [300, 100, 1110, 280], 1.3);
  show('#kmt-o', t0, 0.2);
  cAt('#kmt-i', 770, 330, 0); cShow('#kmt-i', t0, 0.2);
  cMove('#kmt-i', 470, 152, t0 + 0.02, 0.25); cClick('#kmt-i', 470, 152, t0 + 0.3); showFrame('#kmt-i-1', t0 + 0.35);
  showFrame('#kmt-i-2', t0 + 0.45);
  typeFrames('#kmt-i', 3, 2 + TYPED.kmt, t0 + 0.55, 0.05);
  cMove('#kmt-i', 1342, 152, typedEnd + 0.02, 0.3); cClick('#kmt-i', 1342, 152, typedEnd + 0.35);
  setFrame('#kmc-o', '#kmc-i', [300, 100, 1110, 280], 1.3);
  show('#kmc-o', typedEnd + 0.45, 0.2);
  cAt('#kmc-i', 1342, 152, 0); cOn('#kmc-i', typedEnd + 0.45);
  moveTo('#kmc-o', '#kmc-i', [265, 315, 480, 55], typedEnd + 0.55, 0.9, 'power3.out', 2.2);
  cMove('#kmc-i', ...MC_PT, typedEnd + 0.65, 0.7);
  drift('#kmc-i', 10, typedEnd + 1.45, A.kw_list - (typedEnd + 1.45), 'x');
  moveTo('#kmc-o', '#kmc-i', [266, 120, 1150, 700], A.kw_list, 1.4, 'power2.inOut', 1.2);
  cHide('#kmc-i', A.kw_list + 0.1);
  drift('#kmc-i', 10, A.kw_list + 1.4, A.kw_target - 0.3 - (A.kw_list + 1.4));
  moveTo('#kmc-o', '#kmc-i', [266, 330, 820, 480], A.kw_target - 0.3, 3.0, 'sine.inOut', 1.5);
  drift('#kmc-i', 24, A.kw_target + 2.75, E('kw') - A.kw_target - 3.05);
  label('#lb-kw', S.kw + 0.35, S.kw + 4.0);
  out('kw');

  // 4 More features: the sidebar's tools on "a bunch of other features", the pointer running down them; Site Audit
  //   clicked on "our technical site audit" and the audit itself framed; back to the whole app on "but before I leave
  //   you all", and Agent setup clicked on "get set up with your agent".
  setFrame('#ft-o', '#ft-i', [0, 0, W, H]);
  fadeIn('#ft-o', S.feat);
  moveTo('#ft-o', '#ft-i', [0, 170, 380, 560], A.feat_features - 0.4, 1.2, 'power2.inOut', 1.6);
  cAt('#ft-i', 600, 500, 0); cShow('#ft-i', A.feat_features - 0.3, 0.25);
  cMove('#ft-i', 110, 266, A.feat_features - 0.25, 0.8);
  cMove('#ft-i', 110, 394, A.feat_anything - 0.5, 1.0);
  cMove('#ft-i', 110, 558, A.feat_technical - 0.9, 0.8); cClick('#ft-i', 110, 558, A.feat_site - 0.1);
  drift('#ft-i', 12, A.feat_features + 0.8, A.feat_site + 0.05 - (A.feat_features + 0.8));
  moveTo('#ft-o', '#ft-i', [320, 40, 1040, 470], A.feat_site + 0.05, 1.2, 'power2.inOut', 1.4);
  cHide('#ft-i', A.feat_site + 0.2);
  drift('#ft-i', 12, A.feat_site + 1.25, A.feat_but + 0.3 - (A.feat_site + 1.25));
  moveTo('#ft-o', '#ft-i', [0, 0, W, H], A.feat_but + 0.3, 1.2, 'power2.inOut');
  cShow('#ft-i', A.feat_set - 1.2, 0.25);
  cMove('#ft-i', 110, 690, A.feat_set - 1.1, 0.8); cClick('#ft-i', 110, 690, A.feat_agent - 0.1);
  label('#lb-feat', S.feat + 0.3, S.feat + 3.4);
  label('#lb-feat2', A.feat_site + 0.3, A.feat_but + 0.8);
  out('feat');

  // 5 Agent setup: Copy setup prompt clicked on "copy and paste this" (it flips to Copied); the agents as they are named
  //   (Claude Code, ChatGPT, Grok Bot); the Skills tab on "as well as the skills", into the list, the pointer down it on
  //   "a really great place to start", then on /keyword-research and /seo-audit as they are recommended.
  //   Framed above the page footer, which shows this local instance's MCP URL.
  setFrame('#aip-o', '#aip-i', [360, 150, 760, 420], 1.5);
  fadeIn('#aip-o', S.aip);
  cAt('#aip-i', 820, 600, 0); cShow('#aip-i', S.aip + 0.1, 0.25);
  cMove('#aip-i', 621, 435, S.aip + 0.15, A.setup_copy - 0.3 - (S.aip + 0.15)); cClick('#aip-i', 621, 435, A.setup_copy);
  showFrame('#aip-i-1', A.setup_copy + 0.05);
  moveTo('#aip-o', '#aip-i', [520, 362, 520, 46], A.setup_agent - 0.3, 0.9, 'power2.inOut', 2.0);
  cMove('#aip-i', 577, 390, A.setup_claude - 0.4, 0.45);
  cMove('#aip-i', 680, 390, A.setup_chatgpt - 0.35, 0.4);
  cMove('#aip-i', 765, 390, A.setup_grok - 0.35, 0.4);
  moveTo('#aip-o', '#aip-i', [360, 150, 760, 420], A.setup_done - 0.2, 0.9, 'power2.inOut', 1.5);
  cMove('#aip-i', 672, 214, A.setup_done, 0.8); cClick('#aip-i', 672, 214, A.skills_use - 0.25);
  setFrame('#aps-o', '#aps-i', [360, 150, 760, 420], 1.5);
  show('#aps-o', A.skills_use - 0.15, 0.2);
  cAt('#aps-i', 672, 214, 0); cOn('#aps-i', A.skills_use - 0.15);
  moveTo('#aps-o', '#aps-i', [330, 280, 820, 360], A.skills_which + 0.2, 1.2, 'power2.inOut', 1.6);
  cMove('#aps-i', 560, 330, A.skills_which + 0.3, 0.8);
  cMove('#aps-i', 560, 580, Math.max(A.skills_great, A.skills_which + 1.15), 2.4);
  cMove('#aps-i', 615, 415, A.skills_kw - 0.45, 0.5);     // the tip on the end of /keyword-research, so the name reads
  cMove('#aps-i', 570, 387, A.skills_audit - 0.4, 0.4);     // then /seo-audit
  drift('#aps-i', 20, A.skills_which + 1.4, E('aip') - 0.6 - (A.skills_which + 1.4));
  label('#lb-aip', S.aip + 0.3, A.setup_copy + 0.9);
  label('#lb-aip2', A.setup_copy + 1.0, A.setup_done + 0.2);
  label('#lb-aip3', A.skills_use + 0.2, A.skills_use + 3.8);
  tl.to('#s-aip .win', { opacity: 0, y: 14, duration: 0.6, ease: 'power2.inOut' }, E('aip') - 0.6);   // the window leaves for the end card

  // 6 End card: the OpenSEO OG image rises into the window's place.
  tl.fromTo('#end-og', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, S.end + 0.05);
"""

C.write('comp', T, secs, choreo=CHOREO, assets=ASSETS, title='OpenSEO launch video', window_until=T['S']['end'] - 0.8,
        consts=dict(A=A, TYPED={k: len(v) for k, v in EX.items()}, VOL_PT=[478, 341], MC_PT=[492, 341]))
