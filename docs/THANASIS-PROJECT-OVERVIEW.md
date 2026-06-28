# Betting Research Harness - Εξήγηση για τον Θανάση

## Τι προσπαθεί να κάνει το project

Το project δεν είναι bot που "ξέρει ποιος θα κερδίσει". Είναι research και decision system που ψάχνει αν οι ελληνικές/soft αποδόσεις είναι καλύτερες από μια δίκαιη τιμή αγοράς.

Η βασική ιδέα είναι απλή:

- Παίρνουμε αποδόσεις από soft books, κυρίως Stoiximan/Novibet.
- Τις συγκρίνουμε με sharp/reference αγορά, κυρίως Pinnacle/consensus μέσω The Odds API.
- Υπολογίζουμε αν υπάρχει θετικό EV.
- Δεν εμπιστευόμαστε το EV μόνο του. Μετράμε αν οι επιλογές κερδίζουν CLV.
- Μετά βλέπουμε ROI μόνο σε settled paper bets.
- Μέχρι να περάσουν sample gates, δεν ανοίγουμε real staking.

Άρα το προϊόν αυτή τη στιγμή είναι πιο κοντά σε quant research harness παρά σε production betting desk.

## Γιατί έχει νόημα σαν betting λογική

Αν ξέρεις bankroll, unit, ROI και CLV, το project στηρίζεται σε αυτά:

- `ROI`: αν τα paper bets όντως βγάζουν κέρδος όταν γίνουν settle.
- `CLV`: αν η τιμή που "πήραμε" ήταν καλύτερη από την closing line.
- `VALUE vs CONTROL`: αν τα σημεία που το μοντέλο λέει VALUE πάνε καλύτερα από παρόμοιες μη-value επιλογές.
- `Staking sim`: όχι για να ποντάρουμε τώρα, αλλά για να δούμε drawdown και bankroll behavior αν κάποτε το σήμα γίνει αξιόπιστο.

Το πιο σημαντικό εδώ είναι το CLV. Αν μακροπρόθεσμα παίρνεις καλύτερη τιμή από το close, υπάρχει ένδειξη ότι δεν κυνηγάς τύχη αλλά information/price edge.

## Πώς λειτουργεί τεχνικά

Το σύστημα είναι Node.js CLI με scheduled jobs και CSV/JSON reports.

Τα βασικά modules:

- `scan`: βρίσκει paper value bets.
- `clv`: γυρνάει κοντά στην έναρξη και μετράει closing-line value.
- `settle`: ενημερώνει αποτελέσματα και πραγματικό paper ROI.
- `data-health`: βρίσκει corrupt rows, λάθος odds, late CLV, duplicates.
- `profitability-report`: μετρά ROI/CLV ανά segment.
- `calibration-report`: βλέπει αν το EV είναι calibrated ή απλώς ranking signal.
- `staking-sim`: προσομοιώνει flat/Kelly staking μόνο σε settled historical paper rows.
- `daily-decision-report`: λέει καθημερινά αν το σύστημα είναι research-only ή έτοιμο για επόμενο στάδιο.
- `profit-engine`: συνοπτικό readiness snapshot.

Live data:

- Το WebSocket του Odds-API.io είναι ακόμα diagnostic-only, γιατί δίνει 0 odds market messages.
- Το `/odds/updated` fallback δουλεύει και γράφει live training rows.
- Αυτό δεν σημαίνει live betting ready. Σημαίνει μόνο ότι έχουμε λειτουργικό live data path για research.

## Τρέχουσα αξιοπιστία

Ειλικρινής εκτίμηση: το project έχει καλό engineering foundation και promising early signal, αλλά δεν είναι ακόμα επενδύσιμο ως autonomous betting engine.

Τελευταία καθαρή μέτρηση μετά από data-quality quarantine:

- Mode: `RESEARCH_ONLY`
- VALUE h2h settled: `57 / 200`
- VALUE h2h CLV: `111 / 200`
- Main MATCH_RESULT VALUE CLV: `115`
- VALUE avg CLV: περίπου `+1.61%`
- CONTROL avg CLV: περίπου `-2.04%`
- WebSocket market messages: `0`
- Live training rows μέσω fallback: `94`
- Calibration: `RANKING_SIGNAL`, όχι calibrated EV
- Monotonicity: FAIL, γιατί ένα υψηλότερο EV bucket υποαπέδωσε χαμηλότερο bucket

Η θετική πλευρά:

- Το VALUE group φαίνεται να κερδίζει CLV έναντι CONTROL.
- Το pipeline μετράει ROI, CLV, data health και staking risk αντί να πετάει απλά alerts.
- Υπάρχει σοβαρή προστασία από corrupted data, late CLV και invalid odds.

Η αρνητική πλευρά:

- Το sample είναι ακόμα μικρό.
- Το EV δεν είναι ακόμα calibrated.
- Το live WebSocket δεν έχει αποδείξει ότι δίνει usable odds signal.
- Δεν υπάρχει ακόμα liquidity/limit evidence.
- Το production Telegram betting scanner είναι disabled μέχρι να περάσουν gates.

## Πώς θα το έβλεπα σαν investor

Δεν θα το τιμολογούσα ακόμα σαν profitable betting system. Θα το έβλεπα σαν early-stage research infrastructure με καλές πιθανότητες να αποδείξει ή να απορρίψει το edge με σωστό τρόπο.

Το upside είναι ότι αν το h2h VALUE signal κρατήσει θετικό CLV και ROI σε μεγαλύτερο δείγμα, το project μπορεί να γίνει decision system για επιλεκτικά paper/alert bets.

Το risk είναι ότι το τωρινό θετικό CLV μπορεί να είναι sample noise, market mismatch ή αποτέλεσμα περιορισμένου universe. Γι' αυτό τα gates είναι αυστηρά.

## Τι πρέπει να γίνει πριν γίνει serious betting product

Πριν από real staking πρέπει να ισχύουν όλα:

- Τουλάχιστον `200` καθαρά VALUE h2h settled bets.
- Τουλάχιστον `200` καθαρά VALUE h2h CLV samples.
- VALUE CLV θετικό και καλύτερο από CONTROL.
- ROI confidence interval να μη δείχνει ξεκάθαρα αρνητικό edge.
- EV buckets να έχουν λογική σειρά. Αν όχι, το EV μένει ranking score.
- Live source να έχει σταθερά odds/training rows.
- Να υπάρχει liquidity/limits evidence για τα books.
- Να υπάρχει αυστηρό staking cap και όχι emotional unit sizing.

## Bottom line

Το project είναι σοβαρό γιατί πρώτα χτίζει measurement και μετά αποφασίζει για staking. Αυτό είναι το σωστό sequence.

Αυτή τη στιγμή δεν είναι "μηχανή που τυπώνει λεφτά". Είναι ένα καλά δομημένο research harness που δείχνει ενθαρρυντικό h2h CLV signal, αλλά χρειάζεται μεγαλύτερο καθαρό sample πριν αξίζει real-money confidence.

Η σωστή απόφαση σήμερα: συνεχίζουμε collection, κρατάμε alerts/staking κλειστά, και αφήνουμε τα reports να αποφασίσουν πότε το σήμα περνάει από promising σε actionable.
