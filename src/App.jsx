import React from "react";
import { useState, useEffect, useRef } from "react";

// ─── Storage ───────────────────────────────────────────────────────────────────
const KEYS = { users:"wcp_users_v2", matches:"wcp_matches_v2", predictions:"wcp_predictions_v2", squads:"wcp_squads_v4" };

// ─── API-Football config ───────────────────────────────────────────────────────
const API_KEY    = "303afb5a7b753e1ed79fd6a3f2185024";
const API_BASE       = "https://v3.football.api-sports.io";
const API_BASE_PROXY = "https://corsproxy.io/?https://v3.football.api-sports.io";
const WC_LEAGUE  = 1;
const WC_SEASON  = 2026;
const POLL_MS    = 15 * 60 * 1000; // 15 minutes normally

// Returns true if current Riyadh time is in the blackout window (11:00–13:00)
function isBlackoutWindow() {
  const now = new Date();
  const riyadhHour = parseInt(new Intl.DateTimeFormat("en-SA", {
    hour: "numeric", hour12: false, timeZone: "Asia/Riyadh"
  }).format(now));
  return riyadhHour >= 11 && riyadhHour < 13;
}

// Fetch finished/live fixtures for today and sync scores + scorers into matches
async function fetchLiveScores(matches, setMatches) {
  try {
    // Fetch fixtures for the WC league
    const res = await fetch(
      `${API_BASE_PROXY}/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}&timezone=Asia/Riyadh`,
      { headers: { "x-apisports-key": API_KEY } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const fixtures = data.response || [];

    // Only process finished or live fixtures
    const relevant = fixtures.filter(f =>
      ["FT","AET","PEN","1H","2H","HT","ET","P","LIVE"].includes(f.fixture?.status?.short)
    );
    if (!relevant.length) return;

    setMatches(prev => {
      let updated = false;
      const next = prev.map(m => {
        // Match by team names (strip flags for comparison)
        const strip = s => s.replace(/\p{Emoji}/gu, "").trim().toLowerCase();
        const mHome = strip(m.home), mAway = strip(m.away);
        const fixture = relevant.find(f => {
          const fHome = f.teams?.home?.name?.toLowerCase() || "";
          const fAway = f.teams?.away?.name?.toLowerCase() || "";
          return (fHome.includes(mHome) || mHome.includes(fHome)) &&
                 (fAway.includes(mAway) || mAway.includes(fAway));
        });
        if (!fixture) return m;
        const goals = fixture.goals;
        if (goals?.home == null || goals?.away == null) return m;

        // Get scorers
        const events = fixture.events || [];
        const homeScorers = events
          .filter(e => e.team?.id === fixture.teams?.home?.id && e.type === "Goal" && e.detail !== "Own Goal")
          .map(e => e.player?.name || "");
        const awayScorers = events
          .filter(e => e.team?.id === fixture.teams?.away?.id && e.type === "Goal" && e.detail !== "Own Goal")
          .map(e => e.player?.name || "");

        const newResult = {
          home: String(goals.home),
          away: String(goals.away),
          homeScorers,
          awayScorers,
          autoSynced: true,
          lastSync: new Date().toISOString(),
        };
        // Only update if something changed
        if (JSON.stringify(m.result) === JSON.stringify(newResult)) return m;
        updated = true;
        return { ...m, result: newResult };
      });
      return updated ? next : prev;
    });
  } catch (e) {
    console.warn("API-Football sync failed:", e);
  }
}

// ─── Fetch squads from API-Football with position grouping ────────────────────
// squads shape: { teamName: { GK:[], DEF:[], MID:[], ATT:[] } }
// Helper: get all players from a squad object as flat array (for backward compat)
function squadAllPlayers(squad) {
  if (!squad) return [];
  if (Array.isArray(squad)) return squad; // legacy flat array
  return [...(squad.GK||[]), ...(squad.DEF||[]), ...(squad.MID||[]), ...(squad.ATT||[])];
}

// Helper: check if squad is the new grouped format
function isGroupedSquad(squad) {
  return squad && !Array.isArray(squad) && typeof squad === "object";
}


async function load(key) { try { const v=localStorage.getItem(key); return v?JSON.parse(v):null; } catch { return null; } }
async function save(key,val) { try { localStorage.setItem(key,JSON.stringify(val)); } catch {} }

// ─── Super admins ──────────────────────────────────────────────────────────────
const SUPER_ADMINS = ["Faisal"];
const isSuperAdmin = n => SUPER_ADMINS.includes(n);

// ─── Deadline helpers ──────────────────────────────────────────────────────────
function isPredLocked(m) {
  if (!m.kickoffTime) return false;
  return Date.now() >= new Date(m.kickoffTime).getTime() - 2*60*60*1000;
}
function timeUntilDeadline(m) {
  if (!m.kickoffTime) return null;
  const diff = new Date(m.kickoffTime).getTime() - 2*60*60*1000 - Date.now();
  if (diff <= 0) return null;
  const h=Math.floor(diff/3600000), mn=Math.floor((diff%3600000)/60000);
  return h>0?`${h}h ${mn}m left`:`${mn}m left`;
}

// ─── Scoring: flat +1 each, NO multipliers ────────────────────────────────────
// +1 correct outcome (win/draw/loss)
// +3 exact score
// +1 per correctly guessed scorer (order doesn't matter)
function calcPoints(pred, result) {
  if (!result || result.home==null || result.home==="" || result.away==null || result.away==="") return null;
  const rh=parseInt(result.home), ra=parseInt(result.away);
  const ph=parseInt(pred?.homeScore), pa=parseInt(pred?.awayScore);
  if (isNaN(ph)||isNaN(pa)) return null;
  let pts = 0;
  // +1 outcome
  if ((ph>pa?"H":ph<pa?"A":"D")===(rh>ra?"H":rh<ra?"A":"D")) pts += 1;
  // +3 exact score
  if (ph===rh && pa===ra) pts += 3;
  // +1 per correctly guessed scorer (order doesn't matter)
  const realScorers = (result.homeScorers||[]).concat(result.awayScorers||[]).map(s=>s.toLowerCase().trim()).filter(Boolean);
  const predScorers = (pred?.homeScorers||[]).concat(pred?.awayScorers||[]).map(s=>s.toLowerCase().trim()).filter(Boolean);
  predScorers.forEach(ps => {
    if (ps && realScorers.some(rs => rs===ps || rs.includes(ps) || ps.includes(rs))) pts += 1;
  });
  return pts;
}

// ─── Official 2026 WC Squads (confirmed as of May 30 2026) ────────────────────
// Teams marked TBA have not yet announced final squads (deadline June 1)
const DEFAULT_SQUADS = {
  // ── GROUP A ──────────────────────────────────────────────────────────────────
  "Mexico 🇲🇽": {
    GK:["Guillermo Ochoa","Raul Rangel","Carlos Acevedo"],
    DEF:["Jesus Gallardo","Cesar Montes","Jorge Sanchez","Johan Vasquez","Israel Reyes","Mateo Chavez"],
    MID:["Edson Alvarez","Orbelin Pineda","Roberto Alvarado","Luis Romo","Luis Chavez","Erik Lira","Gilberto Mora","Brian Gutierrez","Obed Vargas","Alvaro Fidalgo"],
    ATT:["Raul Jimenez","Alexis Vega","Santiago Gimenez","Cesar Huerta","Julian Quinones","Guillermo Martinez","Armando Gonzalez"]
  },
  "South Africa 🇿🇦": {
    GK:["Ronwen Williams","Ricardo Goss","Sipho Chaine"],
    DEF:["Aubrey Modiba","Khuliso Mudau","Nkosinathi Sibisi","Mbekezeli Mbokazi","Ime Okon","Samukele Kabini","Khulumani Ndamane","Thabang Matuludi","Kamogelo Sebelebele","Bradley Cross","Olwethu Makhanya"],
    MID:["Teboho Mokoena","Sphephelo Sithole","Thalente Mbatha","Jayden Adams"],
    ATT:["Themba Zwane","Lyle Foster","Evidence Makgopa","Oswin Appollis","Iqraam Rayners","Relebohile Mofokeng","Thapelo Maseko","Tshepang Moremi"]
  },
  "South Korea 🇰🇷": {
    GK:["Kim Seung-gyu","Jo Hyeon-woo","Song Bum-keun"],
    DEF:["Kim Min-jae","Kim Moon-hwan","Seol Young-woo","Lee Tae-seok","Park Jin-seob","Kim Tae-hyeon","Lee Han-beom","Jens Castrop","Lee Ki-hyuk","Cho Wi-je"],
    MID:["Lee Jae-sung","Hwang Hee-chan","Hwang In-beom","Lee Kang-in","Paik Seung-ho","Kim Jin-gyu","Lee Dong-gyeong","Bae Jun-ho","Eom Ji-sung","Yang Hyun-jun"],
    ATT:["Son Heung-min","Cho Gue-sung","Oh Hyeon-gyu"]
  },
  "Czechia 🇨🇿": {
    GK:["Matej Kovar","Jindrich Stanek","Lukas Hornicek"],
    DEF:["Vladimir Coufal","Tomas Holes","Ladislav Krejci","David Zima","Jaroslav Zeleny","David Jurasek","David Doudera","Robin Hranac","Stepan Chaloupek"],
    MID:["Tomas Soucek","Vladimir Darida","Lukas Provod","Michal Sadilek","Pavel Sulc","Lukas Cerv","Hugo Sochurek","Alexandr Sojka","Denis Visinsky"],
    ATT:["Patrik Schick","Adam Hlozek","Jan Kuchta","Mojmir Chytil","Tomas Chory"]
  },
  // ── GROUP B ──────────────────────────────────────────────────────────────────
  "Canada 🇨🇦": {
    GK:["Dayne St. Clair","Maxime Crepeau","Owen Goodman"],
    DEF:["Alistair Johnston","Luc de Fougerolles","Alfie Jones","Joel Waterman","Derek Cornelius","Moise Bombito","Alphonso Davies","Richie Laryea","Niko Sigur"],
    MID:["Mathieu Choiniere","Stephen Eustaquio","Ismael Kone","Liam Millar","Jacob Shaffelburg","Jonathan Osorio","Ali Ahmed","Nathan Saliba","Tajon Buchanan"],
    ATT:["Cyle Larin","Jonathan David","Tani Oluwaseyi","Promise David"]
  },
  "Switzerland 🇨🇭": {
    GK:["Gregor Kobel","Yvon Mvogo","Marvin Keller"],
    DEF:["Miro Muheim","Silvan Widmer","Nico Elvedi","Manuel Akanji","Ricardo Rodriguez","Eray Comert","Aurele Amenda","Luca Jaquez"],
    MID:["Denis Zakaria","Remo Freuler","Johan Manzambi","Granit Xhaka","Ardon Jashari","Djibril Sow","Christian Fassnacht","Michel Aebischer","Fabian Rieder"],
    ATT:["Breel Embolo","Dan Ndoye","Noah Okafor","Ruben Vargas","Zeki Amdouni","Cedric Itten"]
  },
  "Qatar 🇶🇦": {
    GK:["Mahmoud Abunada","Salah Zakaria","Meshaal Barsham"],
    DEF:["Pedro Miguel","Lucas Mendes","Issa Laye","Ayoub Al Alawi","Boualem Khoukhi","Sultan Al Brake","Al Hashmi Al Hussain","Homam Ahmed"],
    MID:["Jassem Gaber","Abdulaziz Hatem","Karim Boudiaf","Assim Madibo","Ahmed Fathi","Mohamed Al-Mannai"],
    ATT:["Ahmed Alaaeldin","Edmilson Junior","Mohammed Muntari","Hassan Al-Haydos","Akram Afif","Yusuf Abdurisag","Ahmed Al-Ganehi","Almoez Ali","Tahsin Jamshid"]
  },
  "Bosnia & Herz. 🇧🇦": {
    GK:["Nikola Vasilj","Martin Zlomislic","Osman Hadzikic"],
    DEF:["Sead Kolasinac","Dennis Hadzikadunic","Amar Dedic","Nikola Katic","Tarik Muharemovic","Nihad Mujakic","Stjepan Radeljic","Nidal Celik"],
    MID:["Amir Hadziahmetovic","Benjamin Tahirovic","Armin Gigovic","Dzenis Burnic","Ivan Basic","Esmir Bajraktarevic","Amar Memic","Ivan Sunjic","Kerim Alajbegovic","Ermin Mahmic"],
    ATT:["Edin Dzeko","Ermedin Demirovic","Samed Bazdar","Haris Tabakovic","Jovo Lukic"]
  },
  // ── GROUP C ──────────────────────────────────────────────────────────────────
  "Brazil 🇧🇷": {
    GK:["Alisson","Weverton","Ederson"],
    DEF:["Wesley","Gabriel Magalhaes","Marquinhos","Alex Sandro","Danilo Luiz","Bremer","Leo Pereira","Douglas Santos","Roger Ibanez"],
    MID:["Casemiro","Bruno Guimaraes","Fabinho","Danilo Santos","Lucas Paqueta"],
    ATT:["Vinicius Junior","Matheus Cunha","Neymar","Raphinha","Endrick","Luiz Henrique","Gabriel Martinelli","Igor Thiago","Rayan"]
  },
  "Morocco 🇲🇦": {
    GK:["Yassine Bounou","Munir Mohamedi","Ahmed Reda Tagnaouti"],
    DEF:["Achraf Hakimi","Nayef Aguerd","Noussair Mazraoui","Youssef Belammari","Anass Salah-Eddine","Chadi Riad","Issa Diop","Zakaria El Ouahdi","Redouane Halhal"],
    MID:["Sofyan Amrabat","Azzedine Ounahi","Bilal El Khannouss","Ismael Saibari","Neil El Aynaoui","Samir El Mourabet","Ayyoub Bouaddi"],
    ATT:["Ayoub El Kaabi","Soufiane Rahimi","Abde Ezzalzouli","Brahim Diaz","Chemsdine Talbi","Gessime Yassine","Ayoube Amaimouni"]
  },
  "Haiti 🇭🇹": {
    GK:["Johny Placide","Alexandre Pierre","Josue Duverger"],
    DEF:["Ricardo Ade","Carlens Arcus","Martin Experience","Jean-Kevin Duverne","Duke Lacroix","Wilguens Paugain","Hannes Delcroix","Keeto Thermoncy"],
    MID:["Leverton Pierre","Danley Jean Jacques","Carl Sainte","Jean-Ricner Bellegarde","Woodensky Pierre","Dominique Simon"],
    ATT:["Duckens Nazon","Frantzdy Pierrot","Derrick Etienne Jr.","Louicius Deedson","Ruben Providence","Josue Casimir","Yassin Fortune","Wilson Isidor","Lenny Joseph"]
  },
  "Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿": {
    GK:["Craig Gordon","Angus Gunn","Liam Kelly"],
    DEF:["Andy Robertson","Grant Hanley","Kieran Tierney","Scott McKenna","Jack Hendry","Nathan Patterson","Anthony Ralston","John Souttar","Aaron Hickey","Dominic Hyam"],
    MID:["John McGinn","Scott McTominay","Ryan Christie","Kenny McLean","Lewis Ferguson","Ben Gannon-Doak","Findlay Curtis","Tyler Fletcher"],
    ATT:["Lyndon Dykes","Che Adams","Lawrence Shankland","George Hirst","Ross Stewart"]
  },
  // ── GROUP D ──────────────────────────────────────────────────────────────────
  "USA 🇺🇸": {
    GK:["Matt Turner","Matt Freese","Chris Brady"],
    DEF:["Sergino Dest","Chris Richards","Antonee Robinson","Auston Trusty","Miles Robinson","Tim Ream","Alex Freeman","Max Arfsten","Mark McKenzie","Joe Scally"],
    MID:["Tyler Adams","Giovanni Reyna","Weston McKennie","Sebastian Berhalter","Cristian Roldan","Malik Tillman"],
    ATT:["Ricardo Pepi","Christian Pulisic","Brenden Aaronson","Haji Wright","Folarin Balogun","Timothy Weah","Alejandro Zendejas"]
  },
  "Paraguay 🇵🇾": {
    GK:["Gatito Fernandez","Orlando Gill","Gaston Olveira"],
    DEF:["Gustavo Gomez","Junior Alonso","Fabian Balbuena","Omar Alderete","Juan Jose Caceres","Gustavo Velazquez","Jose Canale","Alexandro Maidana"],
    MID:["Miguel Almiron","Kaku","Andres Cubas","Ramon Sosa","Diego Gomez","Damian Bobadilla","Braian Ojeda","Matias Galarza","Mauricio"],
    ATT:["Antonio Sanabria","Julio Enciso","Gabriel Avalos","Alex Arce","Isidro Pitta","Gustavo Caballero"]
  },
  "Turkey 🇹🇷": {
    GK:["Ugurcan Cakir","Mert Gunok","Altay Bayindir"],
    DEF:["Merih Demiral","Zeki Celik","Caglar Soyuncu","Mert Muldur","Ferdi Kadioglu","Ozan Kabak","Abdulkerim Bardakci","Eren Elmali","Samet Akaydin"],
    MID:["Hakan Calhanoglu","Kaan Ayhan","Orkun Kokcu","Ismail Yuksek","Salih Ozcan"],
    ATT:["Kerem Akturkoglu","Irfan Can Kahveci","Baris Alper Yilmaz","Arda Guler","Kenan Yildiz","Yunus Akgun","Oguz Aydin","Deniz Gul","Can Uzun"]
  },
  "Australia 🇦🇺": {
    GK:["Mathew Ryan","Paul Izzo","Patrick Beach"],
    DEF:["Milos Degenek","Alessandro Circati","Jacob Italiano","Jordan Bos","Jason Geria","Kai Trewin","Aziz Behich","Harry Souttar","Cameron Burgess","Lucas Herrington"],
    MID:["Connor Metcalfe","Ajdin Hrustic","Aiden O'Neill","Cammy Devlin","Jackson Irvine","Paul Okon-Engstler"],
    ATT:["Mathew Leckie","Mohamed Toure","Awer Mabil","Nestory Irankunda","Cristian Volpato","Nishan Velupillay","Tete Yengi"]
  },
  // ── GROUP E ──────────────────────────────────────────────────────────────────
  "Germany 🇩🇪": {
    GK:["Manuel Neuer","Oliver Baumann","Alexander Nubel"],
    DEF:["Antonio Rudiger","Waldemar Anton","Jonathan Tah","Nico Schlotterbeck","David Raum","Nathaniel Brown","Malick Thiaw"],
    MID:["Joshua Kimmich","Aleksandar Pavlovic","Leon Goretzka","Jamie Leweling","Jamal Musiala","Pascal Gross","Angelo Stiller","Florian Wirtz","Leroy Sane","Nadiem Amiri","Felix Nmecha","Lennart Karl"],
    ATT:["Kai Havertz","Nick Woltemade","Maximilian Beier","Deniz Undav"]
  },
  "Curaçao 🇨🇼": {
    GK:["Eloy Room","Tyrick Bodak","Trevor Doornbusch"],
    DEF:["Shurandy Sambo","Jurien Gaari","Roshon van Eijma","Sherel Floranus","Armando Obispo","Joshua Brenet","Riechedly Bazoer","Deveron Fonville"],
    MID:["Godfried Roemeratoe","Juninho Bacuna","Livano Comenencia","Leandro Bacuna","Tyrese Noslin","Ar'jany Martha","Kevin Felida"],
    ATT:["Jurgen Locadia","Jeremy Antonisse","Sontje Hansen","Kenji Gorre","Jearl Margaritha","Brandley Kuwas","Gervane Kastaneer","Tahith Chong"]
  },
  "Ecuador 🇪🇨": {
    GK:["Hernan Galindez","Moises Ramirez","Gonzalo Valle"],
    DEF:["Felix Torres","Piero Hincapie","Joel Ordonez","Willian Pacho","Pervis Estupinan","Angelo Preciado","Jackson Porozo","Yaimar Medina"],
    MID:["Jordy Alcivar","Denil Castillo","John Yeboah","Kendry Paez","Alan Minda","Pedro Vite","Alan Franco","Moises Caicedo","Gonzalo Plata"],
    ATT:["Kevin Rodriguez","Enner Valencia","Anthony Valencia","Jordy Caicedo","Nilson Angulo","Jeremy Arevalo"]
  },
  "Ivory Coast 🇨🇮": {
    GK:["Yahia Fofana","Alban Lafont","Mohamed Kone"],
    DEF:["Ghislain Konan","Odilon Kossounou","Wilfried Singo","Evan Ndicka","Emmanuel Agbadou","Guela Doue","Ousmane Diomande","Christopher Operi"],
    MID:["Franck Kessie","Jean Michael Seri","Ibrahim Sangare","Seko Fofana","Christ Inao Oulai","Parfait Guiagon"],
    ATT:["Nicolas Pepe","Oumar Diakite","Simon Adingra","Evann Guessand","Amad Diallo","Yan Diomande","Bazoumana Toure","Elye Wahi","Ange-Yoan Bonny"]
  },
  // ── GROUP F ──────────────────────────────────────────────────────────────────
  "Japan 🇯🇵": {
    GK:["Zion Suzuki","Keisuke Osako","Tomoki Hayakawa"],
    DEF:["Ko Itakura","Hiroki Ito","Yuto Nagatomo","Ayumu Seko","Yukinari Sugawara","Junnosuke Suzuki","Shogo Taniguchi","Takehiro Tomiyasu","Tsuyoshi Watanabe"],
    MID:["Ritsu Doan","Wataru Endo","Junya Ito","Daichi Kamada","Takefusa Kubo","Keito Nakamura","Kaishu Sano","Ao Tanaka"],
    ATT:["Keisuke Goto","Daizen Maeda","Koki Ogawa","Kento Shiogai","Yuito Suzuki","Ayase Ueda"]
  },
  "Netherlands 🇳🇱": {
    GK:["Mark Flekken","Robin Roefs","Bart Verbruggen"],
    DEF:["Nathan Ake","Virgil van Dijk","Denzel Dumfries","Jan Paul van Hecke","Jurrien Timber","Jorrel Hato","Micky van de Ven"],
    MID:["Ryan Gravenberch","Frenkie de Jong","Teun Koopmeiners","Tijjani Reijnders","Marten de Roon","Guus Til","Quinten Timber","Mats Wieffer"],
    ATT:["Brian Brobbey","Memphis Depay","Cody Gakpo","Noa Lang","Donyell Malen","Crysencio Summerville","Wout Weghorst","Justin Kluivert"]
  },
  "Sweden 🇸🇪": {
    GK:["Viktor Johansson","Gustaf Lagerbielke","Kristoffer Nordfeldt","Jacob Zetterstrom"],
    DEF:["Hjalmar Ekdal","Gabriel Gudmundsson","Isak Hien","Victor Lindelof","Eric Smith","Carl Starfelt","Daniel Svensson"],
    MID:["Yasin Ayari","Lucas Bergvall","Jesper Karlstrom","Benjamin Nygren","Ken Sema","Elliot Stroud","Mattias Svanberg","Besfort Zeneli"],
    ATT:["Taha Ali","Alexander Bernhardsson","Anthony Elanga","Viktor Gyokeres","Alexander Isak","Gustaf Nilsson"]
  },
  "Tunisia 🇹🇳": {
    GK:["Sabri Ben Hessen","Abdelmouhib Chamakh","Aymen Dahman"],
    DEF:["Ali Abdi","Adem Arous","Mohamed Amine Ben Hamida","Dylan Bronn","Raed Chikhaoui","Moutaz Neffati","Omar Rekik","Montassar Talbi","Yan Valery"],
    MID:["Mortadha Ben Ouanes","Anis Ben Slimane","Ismael Gharbi","Rani Khedira","Mohamed Hadj Mahmoud","Hannibal Mejbri","Ellyes Skhiri"],
    ATT:["Elias Achouri","Khalil Ayari","Firas Chaouat","Rayan Elloumi","Hazem Mastouri","Elias Saad","Sebastian Tounekti"]
  },
  // ── GROUP G ──────────────────────────────────────────────────────────────────
  "Belgium 🇧🇪": {
    GK:["Thibaut Courtois","Senne Lammens","Mike Penders"],
    DEF:["Timothy Castagne","Zeno Debast","Maxim De Cuyper","Koni De Winter","Brandon Mechele","Thomas Meunier","Nathan Ngoy","Joaquin Seys","Arthur Theate"],
    MID:["Kevin De Bruyne","Amadou Onana","Nicolas Raskin","Youri Tielemans","Hans Vanaken","Axel Witsel"],
    ATT:["Charles De Ketelaere","Jeremy Doku","Matias Fernandez-Pardo","Romelu Lukaku","Dodi Lukebakio","Diego Moreira","Alexis Saelemaekers","Leandro Trossard"]
  },
  "Egypt 🇪🇬": {
    GK:["Mohamed El Shenawy","Mostafa Shobeir","El Mahdy Soliman","Mohamed Alaa"],
    DEF:["Mohamed Abdelmonem","Mohamed Hany","Yasser Ibrahim","Hossam Abdelmaguid","Ahmed Fattouh","Tarek Alaa","Rami Rabia","Karim Hafez"],
    MID:["Marwan Attia","Ahmed Sayed Zizo","Mahmoud Trezeguet","Emam Ashour","Mostafa Abdel Raouf","Mohannad Lasheen","Haitham Hassan","Mahmoud Saber","Ibrahim Adel","Nabil Emad","Hamdi Fathi"],
    ATT:["Mohamed Salah","Omar Marmoush","Hamza Abdel Karim"]
  },
  "Iran 🇮🇷": {
    GK:["Alireza Beiranvand","Seyed Hossein Hosseini","Payam Niazmand"],
    DEF:["Danial Eiri","Ehsan Hajsafi","Saleh Hardani","Hossein Kanaani","Shoja Khalilzadeh","Milad Mohammadi","Ali Nemati","Ramin Rezaeian"],
    MID:["Rouzbeh Cheshmi","Saeid Ezatolahi","Mehdi Ghaedi","Saman Ghoddos","Mohammad Ghorbani","Alireza Jahanbakhsh","Mohammad Mohebi","Amir Mohammad Razzaghinia","Mehdi Torabi","Aria Yousefi"],
    ATT:["Ali Alipour","Dennis Dargahi","Amirhossein Hosseinzadeh","Mehdi Taremi","Shahriar Moghanlou"]
  },
  "New Zealand 🇳🇿": {
    GK:["Max Crocombe","Alex Paulsen","Michael Woud"],
    DEF:["Tyler Bindon","Michael Boxall","Liberato Cacace","Francis de Vries","Callan Elliot","Tim Payne","Nando Pijnaker","Tommy Smith","Finn Surman"],
    MID:["Lachlan Bayliss","Joe Bell","Matt Garbett","Eli Just","Callum McCowatt","Ben Old","Alex Rufer","Marko Stamenic","Sarpreet Singh","Ryan Thomas"],
    ATT:["Kosta Barbarouses","Jesse Randall","Ben Waine","Chris Wood"]
  },
  // ── GROUP H ──────────────────────────────────────────────────────────────────
  "Spain 🇪🇸": {
    GK:["Unai Simon","David Raya","Joan Garcia"],
    DEF:["Marc Cucurella","Pau Cubarsi","Aymeric Laporte","Alejandro Grimaldo","Pedro Porro","Eric Garcia","Marcos Llorente","Marc Pubill"],
    MID:["Gavi","Rodri","Pedri","Martin Zubimendi","Fabian Ruiz","Alex Baena","Mikel Merino"],
    ATT:["Lamine Yamal","Nico Williams","Dani Olmo","Ferran Torres","Mikel Oyarzabal","Yeremy Pino","Borja Iglesias","Victor Munoz"]
  },
  "Uruguay 🇺🇾": {
    GK:["Sergio Rochet","Fernando Muslera","Santiago Mele"],
    DEF:["Guillermo Varela","Ronald Araujo","Jose Maria Gimenez","Santiago Bueno","Sebastian Caceres","Mathias Olivera","Joaquin Piquerez","Matias Vina"],
    MID:["Maximiliano Araujo","Giorgian de Arrascaeta","Rodrigo Bentancur","Agustin Canobbio","Nicolas de la Cruz","Emiliano Martinez","Facundo Pellistri","Brian Rodriguez","Juan Manuel Sanabria","Manuel Ugarte","Federico Valverde","Rodrigo Zalazar"],
    ATT:["Rodrigo Aguirre","Federico Vinas","Darwin Nunez"]
  },
  "Cape Verde 🇨🇻": {
    GK:["CJ dos Santos","Marcio Rosa","Vozinha"],
    DEF:["Sidny Cabral","Diney Borges","Logan Costa","Roberto Pico Lopes","Steven Moreira","Wagner Pina","Kelvin Pires","Joao Paulo Fernandes","Stopira Tavares"],
    MID:["Telmo Arcanjo","Deroy Duarte","Laros Duarte","Jamiro Monteiro","Kevin Pina","Yannick Semedo"],
    ATT:["Gilson Benchimol","Jovane Cabral","Dailon Livramento","Ryan Mendes","Nuno da Costa","Garry Rodrigues","Willy Semedo","Helio Varela"]
  },
  "Saudi Arabia 🇸🇦": {
    GK:["Nawaf Al Aqidi","Mohamed Al Owais","Ahmed Alkassar"],
    DEF:["Saud Abdulhamid","Jehad Thakri","Abdulelah Al Amri","Hassan Tambakti","Ali Lajami","Hassan Kadesh","Moteb Al Harbi","Nawaf Boushal","Ali Majrashi","Mohammed Abu Alshamat"],
    MID:["Ziyad Al Johani","Nasser Al Dawsari","Mohamed Kanno","Abdullah Al Khaibari","Alaa Al Hejji","Musab Al Juwayr","Sultan Mandash","Ayman Yahya","Khalid Al Ghannam"],
    ATT:["Salem Al Dawsari","Abdullah Al Hamdan","Feras Al Brikan","Saleh Al Shehri"]
  },
  // ── GROUP I ──────────────────────────────────────────────────────────────────
  "France 🇫🇷": {
    GK:["Mike Maignan","Robin Risser","Brice Samba"],
    DEF:["Lucas Digne","Malo Gusto","Lucas Hernandez","Theo Hernandez","Ibrahima Konate","Maxence Lacroix","Jules Kounde","William Saliba","Dayot Upamecano"],
    MID:["N'Golo Kante","Manu Kone","Adrien Rabiot","Aurelien Tchouameni","Warren Zaire-Emery"],
    ATT:["Maghnes Akliouche","Bradley Barcola","Rayan Cherki","Ousmane Dembele","Desire Doue","Michael Olise","Kylian Mbappe","Jean-Philippe Mateta","Marcus Thuram"]
  },
  "Senegal 🇸🇳": {
    GK:["Edouard Mendy","Mory Diaw","Yehvann Diouf"],
    DEF:["Krepin Diatta","Antoine Mendy","Kalidou Koulibaly","El Hadji Malick Diouf","Mamadou Sarr","Moussa Niakhate","Abdoulaye Seck","Ismail Jakobs"],
    MID:["Idrissa Gana Gueye","Pape Gueye","Lamine Camara","Habib Diarra","Pathe Ciss","Pape Matar Sarr","Bara Sapoko Ndiaye"],
    ATT:["Sadio Mane","Ismaila Sarr","Iliman Ndiaye","Assane Diao","Ibrahim Mbaye","Nicolas Jackson","Bamba Dieng","Cherif Ndiaye"]
  },
  "Norway 🇳🇴": {
    GK:["Orjan Nyland","Egil Selvik","Sander Tangvik"],
    DEF:["Kristoffer Ajer","Fredrik Bjorkan","Henrik Falchener","Sondre Langas","Torbjorn Heggem","Marcus Holmgren Pedersen","Julian Ryerson","David Moller Wolfe","Leo Ostigard"],
    MID:["Thelonious Aasgaard","Fredrik Aursnes","Patrick Berg","Sander Berge","Oscar Bobb","Jens Petter Hauge","Antonio Nusa","Andreas Schjelderup","Morten Thorsby","Kristian Thorstvedt","Martin Odegaard"],
    ATT:["Erling Haaland","Alexander Sorloth","Jorgen Strand Larsen"]
  },
  "Iraq 🇮🇶": {
    GK:["Fahad Talib","Jalal Hassan","Ahmed Basil"],
    DEF:["Hussein Ali","Manaf Younis","Zaid Tahseen","Rebin Sulaka","Akam Hashem","Merchas Doski","Ahmed Yahya","Zaid Ismail","Frans Putros","Mustafa Saadoon"],
    MID:["Amir Al Ammari","Kevin Yakob","Zidane Iqbal","Aimar Sher","Ibrahim Bayesh","Ahmed Qasim","Youssef Amyn","Marko Farji"],
    ATT:["Ali Jassim","Ali Al Hamadi","Ali Yousef","Aymen Hussein","Mohanad Ali"]
  },
  // ── GROUP J ──────────────────────────────────────────────────────────────────
  "Argentina 🇦🇷": {
    GK:["Emiliano Martinez","Geronimo Rulli","Juan Musso"],
    DEF:["Leonardo Balerdi","Gonzalo Montiel","Nicolas Tagliafico","Lisandro Martinez","Cristian Romero","Nicolas Otamendi","Facundo Medina","Nahuel Molina"],
    MID:["Leandro Paredes","Rodrigo De Paul","Valentin Barco","Giovani Lo Celso","Exequiel Palacios","Alexis Mac Allister","Enzo Fernandez"],
    ATT:["Julian Alvarez","Lionel Messi","Nicolas Gonzalez","Thiago Almada","Giuliano Simeone","Nicolas Paz","Jose Manuel Lopez","Lautaro Martinez"]
  },
  "Algeria 🇩🇿": {
    GK:["Oussama Benbot","Melvin Masstil","Luca Zidane"],
    DEF:["Achraf Abada","Rayan Ait Nouri","Zinedine Belaid","Rafik Belghali","Ramy Bensebaini","Samir Chergui","Jaouen Hadjam","Aissa Mandi","Mohamed Amine Tougai"],
    MID:["Houssem Aouar","Nabil Bentaleb","Hicham Boudaoui","Fares Chaibi","Ibrahim Maza","Yassine Titraoui","Ramiz Zerrouki"],
    ATT:["Mohamed Amine Amoura","Nadir Benbouali","Adil Boulbina","Fares Ghedjemis","Amine Gouiri","Riyad Mahrez","Anis Hadj Moussa"]
  },
  "Austria 🇦🇹": {
    GK:["Patrick Pentz","Alexander Schlager","Florian Wiegele"],
    DEF:["David Affengruber","David Alaba","Kevin Danso","Marco Friedl","Philipp Lienhart","Phillipp Mwene","Stefan Posch","Alexander Prass","Michael Svoboda"],
    MID:["Christoph Baumgartner","Carney Chukwuemeka","Florian Grillitsch","Konrad Laimer","Marcel Sabitzer","Xaver Schlager","Romano Schmid","Alessandro Schopf","Nicolas Seiwald","Paul Wanner","Patrick Wimmer"],
    ATT:["Marko Arnautovic","Michael Gregoritsch","Sasa Kalajdzic"]
  },
  "Jordan 🇯🇴": {
    GK:["Yazid Abulaila","Noor Bani Attiah","Abdallah Al Fakhouri"],
    DEF:["Mohammad Abu Hashish","Abdullah Nasib","Hussam Abu Dhahab","Yazan Al Arab","Mohammad Abu Alnadi","Salem Obaid","Saed Al Rosan","Ehsan Haddad","Anas Badawi"],
    MID:["Amer Jamous","Noor Al Rawabdeh","Rajaei Ayed","Ibrahim Sadeh","Mohannad Abu Taha","Nizar Al Rashdan","Mohammad Al Dawoud","Mahmoud Mardahi"],
    ATT:["Mohammad Abu Zraiq","Ali Olwan","Mousa Al Tamari","Odeh Fakhoury","Ibrahim Sabra","Ali Azaizeh"]
  },
  // ── GROUP K ──────────────────────────────────────────────────────────────────
  "Portugal 🇵🇹": {
    GK:["Diogo Costa","Jose Sa","Rui Silva"],
    DEF:["Tomas Araujo","Joao Cancelo","Diogo Dalot","Ruben Dias","Goncalo Inacio","Nuno Mendes","Matheus Nunes","Nelson Semedo","Renato Veiga"],
    MID:["Samuel Costa","Bruno Fernandes","Joao Neves","Ruben Neves","Bernardo Silva","Vitinha"],
    ATT:["Francisco Conceicao","Joao Felix","Goncalo Guedes","Rafael Leao","Pedro Neto","Goncalo Ramos","Cristiano Ronaldo","Francisco Trincao"]
  },
  "Colombia 🇨🇴": {
    GK:["Camilo Vargas","Alvaro Montero","David Ospina"],
    DEF:["Davinson Sanchez","Jhon Lucumi","Yerry Mina","Willer Ditta","Daniel Munoz","Santiago Arias","Johan Mojica","Deiver Machado"],
    MID:["Richard Rios","Jefferson Lerma","Kevin Castano","Juan Camilo Portilla","Gustavo Puerta","Jhon Arias","Jorge Carrascal","Juan Fernando Quintero","James Rodriguez","Jaminton Campaz"],
    ATT:["Juan Camilo Hernandez","Luis Diaz","Luis Suarez","Carlos Gomez","Jhon Cordoba"]
  },
  "DR Congo 🇨🇩": {
    GK:["Matthieu Epolo","Timothy Fayulu","Lionel Mpasi"],
    DEF:["Dylan Batubinsika","Gedeon Kalulu","Steve Kapuadi","Joris Kayembe","Arthur Masuaku","Chancel Mbemba","Axel Tuanzebe","Aaron Wan-Bissaka"],
    MID:["Brian Cipenga","Meshack Elia","Gael Kakuta","Edo Kayembe","Nathanael Mbuku","Samuel Moutoussamy","Ngal'ayel Mukau","Charles Pickel","Noah Sadiki","Aaron Tshibola"],
    ATT:["Cedric Bakambu","Simon Banza","Fiston Mayele","Yoane Wissa","Theo Bongonda"]
  },
  "Uzbekistan 🇺🇿": {
    GK:["Botirali Ergashev","Abduvohid Nematov","Utkir Yusupov"],
    DEF:["Abdukodir Khusanov","Khojiakbar Alijonov","Rustamjon Ashurmatov","Farrukh Sayfiev","Sherzod Nasrullaev","Umarbek Eshmuradov","Avazbek Ulmasaliev","Jakhongir Urozov","Bekhruz Karimov","Abdulla Abdullaev"],
    MID:["Akmal Mozgovoy","Otabek Shukurov","Jamshid Iskanderov","Odiljon Hamrobekov","Jaloliddin Masharipov","Azizbek Ganiev","Sherzod Esanov","Abbosbek Fayzullaev"],
    ATT:["Azizbek Amonov","Eldor Shomurodov","Igor Sergeev","Oston Urunov","Dostonbek Hamdamov"]
  },
  // ── GROUP L ──────────────────────────────────────────────────────────────────
  "England 🏴󠁧󠁢󠁥󠁮󠁧󠁿": {
    GK:["Jordan Pickford","Dean Henderson","James Trafford"],
    DEF:["Reece James","Ezri Konsa","Jarell Quansah","John Stones","Marc Guehi","Dan Burn","Nico O'Reilly","Djed Spence","Tino Livramento"],
    MID:["Declan Rice","Elliot Anderson","Kobbie Mainoo","Jordan Henderson","Morgan Rogers","Jude Bellingham","Eberechi Eze"],
    ATT:["Harry Kane","Ivan Toney","Ollie Watkins","Bukayo Saka","Marcus Rashford","Anthony Gordon","Noni Madueke"]
  },
  "Croatia 🇭🇷": {
    GK:["Dominik Livakovic","Dominik Kotarski","Ivor Pandur"],
    DEF:["Josko Gvardiol","Duje Caleta-Car","Josip Sutalo","Josip Stanisic","Marin Pongracic","Martin Erlic","Luka Vuskovic"],
    MID:["Luka Modric","Mateo Kovacic","Mario Pasalic","Nikola Vlasic","Luka Sucic","Martin Baturina","Kristijan Jakic","Petar Sucic","Nikola Moro","Toni Fruk"],
    ATT:["Ivan Perisic","Andrej Kramaric","Ante Budimir","Marco Pasalic","Petar Musa","Igor Matanovic"]
  },
  "Ghana 🇬🇭": {
    GK:["Joseph Anang","Benjamin Asare","Lawrence Ati-Zigi"],
    DEF:["Jonas Adjetey","Derrick Luckassen","Gideon Mensah","Abdul Mumin","Jerome Opoku","Kojo Oppong Preprah","Baba Abdul Rahman","Alidu Seidu","Marvin Senaya"],
    MID:["Augustine Boakye","Abdul Fatawu Issahaku","Elisha Owusu","Thomas Partey","Kwasi Sibo","Kamal Deen Sulemana","Caleb Yirenkyi"],
    ATT:["Prince Kwabena Adu","Jordan Ayew","Christopher Bonsu Baah","Ernest Nuamah","Antoine Semenyo","Brandon Thomas-Asante","Inaki Williams"]
  },
  "Panama 🇵🇦": {
    GK:["Orlando Mosquera","Luis Mejia","Cesar Samudio"],
    DEF:["Cesar Blackman","Jorge Gutierrez","Amir Murillo","Fidel Escobar","Andres Andrade","Edgardo Farina","Jose Cordoba","Eric Davis","Jiovany Ramos","Roderick Miller"],
    MID:["Anibal Godoy","Adalberto Carrasquilla","Carlos Harvey","Cristian Martinez","Jose Luis Rodriguez","Cesar Yanis","Yoel Barcenas","Alberto Quintero","Azarias Londono"],
    ATT:["Ismael Diaz","Cecilio Waterman","Jose Fajardo","Tomas Rodriguez"]
  },
};

// ─── Full 2026 WC matches ──────────────────────────────────────────────────────
const DEFAULT_MATCHES = [
  // GROUP A: Mexico, South Africa, South Korea, Czechia
  {id:1,  phase:"Group A", home:"Mexico 🇲🇽",        away:"South Africa 🇿🇦",  date:"Jun 11"},
  {id:2,  phase:"Group A", home:"South Korea 🇰🇷",   away:"Czechia 🇨🇿",       date:"Jun 11"},
  {id:3,  phase:"Group A", home:"Mexico 🇲🇽",        away:"South Korea 🇰🇷",   date:"Jun 15"},
  {id:4,  phase:"Group A", home:"South Africa 🇿🇦",  away:"Czechia 🇨🇿",       date:"Jun 15"},
  {id:5,  phase:"Group A", home:"Mexico 🇲🇽",        away:"Czechia 🇨🇿",       date:"Jun 19"},
  {id:6,  phase:"Group A", home:"South Africa 🇿🇦",  away:"South Korea 🇰🇷",   date:"Jun 19"},
  // GROUP B: Canada, Switzerland, Qatar, Bosnia-Herzegovina
  {id:7,  phase:"Group B", home:"Canada 🇨🇦",        away:"Bosnia & Herz. 🇧🇦", date:"Jun 12"},
  {id:8,  phase:"Group B", home:"Qatar 🇶🇦",         away:"Switzerland 🇨🇭",   date:"Jun 13"},
  {id:9,  phase:"Group B", home:"Canada 🇨🇦",        away:"Qatar 🇶🇦",         date:"Jun 16"},
  {id:10, phase:"Group B", home:"Switzerland 🇨🇭",   away:"Bosnia & Herz. 🇧🇦", date:"Jun 17"},
  {id:11, phase:"Group B", home:"Canada 🇨🇦",        away:"Switzerland 🇨🇭",   date:"Jun 21"},
  {id:12, phase:"Group B", home:"Bosnia & Herz. 🇧🇦",away:"Qatar 🇶🇦",         date:"Jun 21"},
  // GROUP C: Brazil, Morocco, Haiti, Scotland
  {id:13, phase:"Group C", home:"Brazil 🇧🇷",        away:"Morocco 🇲🇦",       date:"Jun 13"},
  {id:14, phase:"Group C", home:"Haiti 🇭🇹",         away:"Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿",   date:"Jun 13"},
  {id:15, phase:"Group C", home:"Brazil 🇧🇷",        away:"Haiti 🇭🇹",         date:"Jun 17"},
  {id:16, phase:"Group C", home:"Morocco 🇲🇦",       away:"Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿",   date:"Jun 17"},
  {id:17, phase:"Group C", home:"Brazil 🇧🇷",        away:"Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿",   date:"Jun 21"},
  {id:18, phase:"Group C", home:"Morocco 🇲🇦",       away:"Haiti 🇭🇹",         date:"Jun 21"},
  // GROUP D: USA, Paraguay, Turkey, Australia
  {id:19, phase:"Group D", home:"USA 🇺🇸",           away:"Paraguay 🇵🇾",      date:"Jun 12"},
  {id:20, phase:"Group D", home:"Turkey 🇹🇷",        away:"Australia 🇦🇺",     date:"Jun 13"},
  {id:21, phase:"Group D", home:"USA 🇺🇸",           away:"Turkey 🇹🇷",        date:"Jun 17"},
  {id:22, phase:"Group D", home:"Australia 🇦🇺",     away:"Paraguay 🇵🇾",      date:"Jun 17"},
  {id:23, phase:"Group D", home:"USA 🇺🇸",           away:"Australia 🇦🇺",     date:"Jun 21"},
  {id:24, phase:"Group D", home:"Paraguay 🇵🇾",      away:"Turkey 🇹🇷",        date:"Jun 21"},
  // GROUP E: Germany, Curaçao, Ecuador, Ivory Coast
  {id:25, phase:"Group E", home:"Germany 🇩🇪",       away:"Curaçao 🇨🇼",       date:"Jun 14"},
  {id:26, phase:"Group E", home:"Ecuador 🇪🇨",       away:"Ivory Coast 🇨🇮",   date:"Jun 14"},
  {id:27, phase:"Group E", home:"Germany 🇩🇪",       away:"Ecuador 🇪🇨",       date:"Jun 18"},
  {id:28, phase:"Group E", home:"Curaçao 🇨🇼",       away:"Ivory Coast 🇨🇮",   date:"Jun 18"},
  {id:29, phase:"Group E", home:"Germany 🇩🇪",       away:"Ivory Coast 🇨🇮",   date:"Jun 22"},
  {id:30, phase:"Group E", home:"Curaçao 🇨🇼",       away:"Ecuador 🇪🇨",       date:"Jun 22"},
  // GROUP F: Japan, Netherlands, Sweden, Tunisia
  {id:31, phase:"Group F", home:"Japan 🇯🇵",         away:"Netherlands 🇳🇱",   date:"Jun 14"},
  {id:32, phase:"Group F", home:"Sweden 🇸🇪",        away:"Tunisia 🇹🇳",       date:"Jun 15"},
  {id:33, phase:"Group F", home:"Japan 🇯🇵",         away:"Sweden 🇸🇪",        date:"Jun 19"},
  {id:34, phase:"Group F", home:"Netherlands 🇳🇱",   away:"Tunisia 🇹🇳",       date:"Jun 19"},
  {id:35, phase:"Group F", home:"Japan 🇯🇵",         away:"Tunisia 🇹🇳",       date:"Jun 23"},
  {id:36, phase:"Group F", home:"Netherlands 🇳🇱",   away:"Sweden 🇸🇪",        date:"Jun 23"},
  // GROUP G: Belgium, Egypt, Iran, New Zealand
  {id:37, phase:"Group G", home:"Belgium 🇧🇪",       away:"Egypt 🇪🇬",         date:"Jun 15"},
  {id:38, phase:"Group G", home:"Iran 🇮🇷",          away:"New Zealand 🇳🇿",   date:"Jun 15"},
  {id:39, phase:"Group G", home:"Belgium 🇧🇪",       away:"Iran 🇮🇷",          date:"Jun 19"},
  {id:40, phase:"Group G", home:"Egypt 🇪🇬",         away:"New Zealand 🇳🇿",   date:"Jun 19"},
  {id:41, phase:"Group G", home:"Belgium 🇧🇪",       away:"New Zealand 🇳🇿",   date:"Jun 23"},
  {id:42, phase:"Group G", home:"Egypt 🇪🇬",         away:"Iran 🇮🇷",          date:"Jun 23"},
  // GROUP H: Cape Verde, Saudi Arabia, Spain, Uruguay
  {id:43, phase:"Group H", home:"Spain 🇪🇸",         away:"Uruguay 🇺🇾",       date:"Jun 15"},
  {id:44, phase:"Group H", home:"Cape Verde 🇨🇻",    away:"Saudi Arabia 🇸🇦",  date:"Jun 16"},
  {id:45, phase:"Group H", home:"Spain 🇪🇸",         away:"Cape Verde 🇨🇻",    date:"Jun 20"},
  {id:46, phase:"Group H", home:"Saudi Arabia 🇸🇦",  away:"Uruguay 🇺🇾",       date:"Jun 20"},
  {id:47, phase:"Group H", home:"Spain 🇪🇸",         away:"Saudi Arabia 🇸🇦",  date:"Jun 24"},
  {id:48, phase:"Group H", home:"Uruguay 🇺🇾",       away:"Cape Verde 🇨🇻",    date:"Jun 24"},
  // GROUP I: France, Senegal, Norway, Iraq
  {id:49, phase:"Group I", home:"France 🇫🇷",        away:"Iraq 🇮🇶",          date:"Jun 16"},
  {id:50, phase:"Group I", home:"Senegal 🇸🇳",       away:"Norway 🇳🇴",        date:"Jun 16"},
  {id:51, phase:"Group I", home:"France 🇫🇷",        away:"Senegal 🇸🇳",       date:"Jun 20"},
  {id:52, phase:"Group I", home:"Norway 🇳🇴",        away:"Iraq 🇮🇶",          date:"Jun 20"},
  {id:53, phase:"Group I", home:"France 🇫🇷",        away:"Norway 🇳🇴",        date:"Jun 24"},
  {id:54, phase:"Group I", home:"Senegal 🇸🇳",       away:"Iraq 🇮🇶",          date:"Jun 24"},
  // GROUP J: Algeria, Argentina, Austria, Jordan
  {id:55, phase:"Group J", home:"Argentina 🇦🇷",     away:"Jordan 🇯🇴",        date:"Jun 16"},
  {id:56, phase:"Group J", home:"Algeria 🇩🇿",       away:"Austria 🇦🇹",       date:"Jun 17"},
  {id:57, phase:"Group J", home:"Argentina 🇦🇷",     away:"Algeria 🇩🇿",       date:"Jun 21"},
  {id:58, phase:"Group J", home:"Austria 🇦🇹",       away:"Jordan 🇯🇴",        date:"Jun 21"},
  {id:59, phase:"Group J", home:"Argentina 🇦🇷",     away:"Austria 🇦🇹",       date:"Jun 25"},
  {id:60, phase:"Group J", home:"Jordan 🇯🇴",        away:"Algeria 🇩🇿",       date:"Jun 25"},
  // GROUP K: Colombia, DR Congo, Portugal, Uzbekistan
  {id:61, phase:"Group K", home:"Portugal 🇵🇹",      away:"Colombia 🇨🇴",      date:"Jun 17"},
  {id:62, phase:"Group K", home:"DR Congo 🇨🇩",      away:"Uzbekistan 🇺🇿",    date:"Jun 17"},
  {id:63, phase:"Group K", home:"Portugal 🇵🇹",      away:"DR Congo 🇨🇩",      date:"Jun 22"},
  {id:64, phase:"Group K", home:"Colombia 🇨🇴",      away:"Uzbekistan 🇺🇿",    date:"Jun 22"},
  {id:65, phase:"Group K", home:"Portugal 🇵🇹",      away:"Uzbekistan 🇺🇿",    date:"Jun 26"},
  {id:66, phase:"Group K", home:"Colombia 🇨🇴",      away:"DR Congo 🇨🇩",      date:"Jun 26"},
  // GROUP L: England, Croatia, Ghana, Panama
  {id:67, phase:"Group L", home:"England 🏴󠁧󠁢󠁥󠁮󠁧󠁿",   away:"Panama 🇵🇦",        date:"Jun 17"},
  {id:68, phase:"Group L", home:"Croatia 🇭🇷",       away:"Ghana 🇬🇭",         date:"Jun 18"},
  {id:69, phase:"Group L", home:"England 🏴󠁧󠁢󠁥󠁮󠁧󠁿",   away:"Croatia 🇭🇷",       date:"Jun 22"},
  {id:70, phase:"Group L", home:"Ghana 🇬🇭",         away:"Panama 🇵🇦",        date:"Jun 22"},
  {id:71, phase:"Group L", home:"England 🏴󠁧󠁢󠁥󠁮󠁧󠁿",   away:"Ghana 🇬🇭",         date:"Jun 26"},
  {id:72, phase:"Group L", home:"Panama 🇵🇦",        away:"Croatia 🇭🇷",       date:"Jun 26"},
  {id:73,  phase:"Round of 32", home:"1A", away:"2B", date:"Jun 29"},
  {id:74,  phase:"Round of 32", home:"1B", away:"2A", date:"Jun 29"},
  {id:75,  phase:"Round of 32", home:"1C", away:"2D", date:"Jun 30"},
  {id:76,  phase:"Round of 32", home:"1D", away:"2C", date:"Jun 30"},
  {id:77,  phase:"Round of 32", home:"1E", away:"2F", date:"Jul 1"},
  {id:78,  phase:"Round of 32", home:"1F", away:"2E", date:"Jul 1"},
  {id:79,  phase:"Round of 32", home:"1G", away:"2H", date:"Jul 2"},
  {id:80,  phase:"Round of 32", home:"1H", away:"2G", date:"Jul 2"},
  {id:81,  phase:"Round of 32", home:"1I", away:"2J", date:"Jul 3"},
  {id:82,  phase:"Round of 32", home:"1J", away:"2I", date:"Jul 3"},
  {id:83,  phase:"Round of 32", home:"1K", away:"2L", date:"Jul 4"},
  {id:84,  phase:"Round of 32", home:"1L", away:"2K", date:"Jul 4"},
  {id:85,  phase:"Round of 32", home:"3rd best 1", away:"3rd best 2", date:"Jul 5"},
  {id:86,  phase:"Round of 32", home:"3rd best 3", away:"3rd best 4", date:"Jul 5"},
  {id:87,  phase:"Round of 32", home:"W73", away:"W74", date:"Jul 5"},
  {id:88,  phase:"Round of 32", home:"W75", away:"W76", date:"Jul 6"},
  {id:89,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 7"},
  {id:90,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 7"},
  {id:91,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 8"},
  {id:92,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 8"},
  {id:93,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 9"},
  {id:94,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 9"},
  {id:95,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 10"},
  {id:96,  phase:"Round of 16", home:"TBD", away:"TBD", date:"Jul 10"},
  {id:97,  phase:"Quarter-Final", home:"TBD", away:"TBD", date:"Jul 14"},
  {id:98,  phase:"Quarter-Final", home:"TBD", away:"TBD", date:"Jul 14"},
  {id:99,  phase:"Quarter-Final", home:"TBD", away:"TBD", date:"Jul 15"},
  {id:100, phase:"Quarter-Final", home:"TBD", away:"TBD", date:"Jul 15"},
  {id:101, phase:"Semi-Final", home:"TBD", away:"TBD", date:"Jul 18"},
  {id:102, phase:"Semi-Final", home:"TBD", away:"TBD", date:"Jul 19"},
  {id:103, phase:"Third Place", home:"TBD", away:"TBD", date:"Jul 22"},
  {id:104, phase:"Final", home:"TBD", away:"TBD", date:"Jul 26"},
];

// ─── UI helpers ────────────────────────────────────────────────────────────────
function Pill({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background:active?"#e8c000":"rgba(255,255,255,.05)",
      color:active?"#0a0d18":"#7a8aaa",
      border:`1px solid ${active?"#e8c000":"rgba(255,255,255,.08)"}`,
      borderRadius:20, padding:"5px 14px", cursor:"pointer",
      fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:12, transition:"all .15s",
    }}>{children}</button>
  );
}

function PinPad({ value, onChange, label }) {
  const digits=[1,2,3,4,5,6,7,8,9,null,0,"⌫"];
  return (
    <div>
      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#7a8aaa",marginBottom:10}}>{label}</div>
      <div style={{display:"flex",gap:10,marginBottom:16,justifyContent:"center"}}>
        {[0,1,2,3].map(i=><div key={i} style={{width:16,height:16,borderRadius:"50%",background:value.length>i?"#e8c000":"rgba(255,255,255,.15)",transition:"background .15s"}}/>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,maxWidth:200,margin:"0 auto"}}>
        {digits.map((d,i)=>(
          <button key={i} onClick={()=>{
            if(d===null)return;
            if(d==="⌫") onChange(value.slice(0,-1));
            else if(value.length<4) onChange(value+d);
          }} style={{background:d===null?"transparent":"rgba(255,255,255,.07)",border:d===null?"none":"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"14px 0",cursor:d===null?"default":"pointer",color:d==="⌫"?"#e8c000":"#f0f0f0",fontFamily:"'DM Sans',sans-serif",fontSize:d==="⌫"?18:20,fontWeight:600}}>{d}</button>
        ))}
      </div>
    </div>
  );
}

// Dropdown scorer picker — supports grouped { GK, DEF, MID, ATT } or flat array
function ScorerPicker({ value, onChange, squad, placeholder, disabled }) {
  const isGrouped = isGroupedSquad(squad);
  const groups = isGrouped
    ? [
        { label: "🧤 Goalkeepers", players: squad.GK || [] },
        { label: "🛡️ Defenders",   players: squad.DEF || [] },
        { label: "⚙️ Midfielders", players: squad.MID || [] },
        { label: "⚡ Attackers",   players: squad.ATT || [] },
      ].filter(g => g.players.length > 0)
    : [];
  const flatPlayers = !isGrouped ? (squad || []) : [];
  const hasPlayers = isGrouped ? groups.some(g=>g.players.length>0) : flatPlayers.length > 0;

  return (
    <select value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled||!hasPlayers} style={{
      background: disabled||!hasPlayers ? "rgba(255,255,255,.03)" : "rgba(100,140,255,.08)",
      border:"1px solid rgba(100,140,255,.2)", borderRadius:8, padding:"6px 10px",
      color: value ? "#c0d0e8" : "#4a5a7a", fontSize:12, fontFamily:"'DM Sans',sans-serif",
      cursor: disabled||!hasPlayers ? "default" : "pointer", width:"100%",
    }}>
      <option value="">{hasPlayers ? (placeholder||"— pick player —") : "No squad loaded"}</option>
      {isGrouped
        ? groups.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.players.map(p => <option key={p} value={p}>{p}</option>)}
            </optgroup>
          ))
        : flatPlayers.map(p => <option key={p} value={p}>{p}</option>)
      }
    </select>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [users, setUsers]             = useState({});
  const [matches, setMatches]         = useState(DEFAULT_MATCHES);
  const [predictions, setPredictions] = useState({});
  // squads: { "Spain 🇪🇸": ["Yamal", "Morata", ...], ... }
  const [squads, setSquads]           = useState({});
  const [session, setSession]         = useState(null);
  const [page, setPage]               = useState("scoreboard");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [authMode, setAuthMode]       = useState("login");
  const [authName, setAuthName]       = useState("");
  const [authPin, setAuthPin]         = useState("");
  const [authErr, setAuthErr]         = useState("");
  const [loaded, setLoaded]           = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [lastApiSync, setLastApiSync] = useState(null);
  const [apiSyncing, setApiSyncing]   = useState(false);
  const [phaseFilter, setPhaseFilter] = useState("All");
  const [toast, setToast]             = useState(null);

  useEffect(()=>{ const t=setInterval(()=>{},60000); return ()=>clearInterval(t); },[]);

  // ── Load ──────────────────────────────────────────────────────────────────────
  useEffect(()=>{(async()=>{
    const u=await load(KEYS.users), m=await load(KEYS.matches),
          p=await load(KEYS.predictions), sq=await load(KEYS.squads);
    if(u) setUsers(u);
    if(m&&m.length>=100) setMatches(m); else setMatches(DEFAULT_MATCHES);
    if(p) setPredictions(p);
    setSquads(DEFAULT_SQUADS);
    setLastRefresh(new Date()); setLoaded(true);
  })();},[]);

  // ── Poll 30s ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    const poll=async()=>{
      const m=await load(KEYS.matches), p=await load(KEYS.predictions),
            u=await load(KEYS.users), sq=await load(KEYS.squads);
      if(m) setMatches(m); if(p) setPredictions(p);
      if(u) setUsers(u);
      setLastRefresh(new Date());
    };
    const iv=setInterval(poll,30000);
    const vis=()=>{ if(document.visibilityState==="visible") poll(); };
    document.addEventListener("visibilitychange",vis);
    return()=>{ clearInterval(iv); document.removeEventListener("visibilitychange",vis); };
  },[]);

  // ── Live score sync via API-Football every 15min (skip 11:00–13:00 Riyadh) ───
  useEffect(() => {
    const sync = async (force = false) => {
      if (!force && isBlackoutWindow()) {
        console.log("API sync skipped — blackout window (11:00–13:00 Riyadh)");
        return;
      }
      setApiSyncing(true);
      await fetchLiveScores(matches, setMatches);
      setLastApiSync(new Date());
      setApiSyncing(false);
    };
    // Run immediately on load
    sync();
    const iv = setInterval(() => sync(), POLL_MS);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  useEffect(()=>{ if(loaded) save(KEYS.matches,matches); },[matches]);
  useEffect(()=>{ if(loaded) save(KEYS.predictions,predictions); },[predictions]);
  useEffect(()=>{ if(loaded) save(KEYS.squads,squads); },[squads]);

  const showToast=msg=>{ setToast(msg); setTimeout(()=>setToast(null),2600); };

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const handleAuth=()=>{
    const name=authName.trim();
    if(!name) return setAuthErr("Enter a username");
    if(authPin.length!==4) return setAuthErr("PIN must be 4 digits");
    if(authMode==="register"){
      if(users[name]) return setAuthErr("Username already taken");
      const isAdmin=isSuperAdmin(name);
      setUsers({...users,[name]:{pin:authPin,isAdmin,superAdmin:isSuperAdmin(name)}});
      setSession(name); setPage("scoreboard");
      setAuthErr(""); setAuthName(""); setAuthPin("");
    } else {
      if(!users[name]) return setAuthErr("User not found");
      if(users[name].pin!==authPin) return setAuthErr("Wrong PIN");
      setSession(name); setPage("scoreboard");
      setAuthErr(""); setAuthName(""); setAuthPin("");
    }
  };

  const setPred=(matchId,field,val)=>{
    setPredictions(prev=>({...prev,[session]:{...prev[session],[matchId]:{...prev[session]?.[matchId],[field]:val}}}));
  };

  // ── Leaderboard ───────────────────────────────────────────────────────────────
  const leaderboard = Object.keys(users).map(u=>{
    let total=0, outcome=0, exact=0, scorerPts=0, played=0;
    matches.forEach(m=>{
      const pts=calcPoints(predictions[u]?.[m.id], m.result);
      if(pts!==null){
        played++; total+=pts;
        const pred=predictions[u]?.[m.id], res=m.result;
        if(res&&pred){
          const rh=parseInt(res.home),ra=parseInt(res.away),ph=parseInt(pred.homeScore),pa=parseInt(pred.awayScore);
          if(!isNaN(ph)&&!isNaN(pa)){
            if((ph>pa?"H":ph<pa?"A":"D")===(rh>ra?"H":rh<ra?"A":"D")) outcome++;
            if(ph===rh&&pa===ra) exact++;
          }
          const rs=(res.homeScorers||[]).concat(res.awayScorers||[]).map(s=>s.toLowerCase().trim()).filter(Boolean);
          const ps=(pred.homeScorers||[]).concat(pred.awayScorers||[]).map(s=>s.toLowerCase().trim()).filter(Boolean);
          ps.forEach(p=>{ if(p&&rs.some(r=>r===p||r.includes(p)||p.includes(r))) scorerPts++; });
        }
      }
    });
    return {name:u,total,outcome,exact,scorerPts,played};
  }).sort((a,b)=>b.total-a.total);

  const isAdmin = session&&(users[session]?.isAdmin||isSuperAdmin(session));
  const phases  = ["All",...new Set(matches.map(m=>m.phase))];
  const visibleMatches = phaseFilter==="All"?matches:matches.filter(m=>m.phase===phaseFilter);

  const tabs=[
    {key:"scoreboard",label:"🏆 Scoreboard"},
    {key:"matches",   label:"📅 Matches"},
    {key:"players",   label:"👥 Players"},
    ...(session?[{key:"predict",label:"📝 My Picks"}]:[]),
    ...(isAdmin?[{key:"admin",label:"⚙️ Admin"}]:[]),
    ...(!session?[{key:"auth",label:"👤 Sign in"}]:[]),
  ];

  return (
    <div style={{minHeight:"100vh",background:"#080c18",color:"#f0f0f0",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input,select{outline:none;}
        input[type=number]{-moz-appearance:textfield;}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        button:focus{outline:none;}
        select option{background:#12182b;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:#2a3050;border-radius:4px;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
        .fi{animation:fadeIn .3s ease both}
      `}</style>

      {toast&&<div style={{position:"fixed",bottom:28,left:"50%",transform:"translateX(-50%)",background:"#e8c000",color:"#080c18",borderRadius:30,padding:"10px 24px",fontWeight:700,fontSize:14,zIndex:999,animation:"toastIn .3s ease",whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(232,192,0,.4)"}}>{toast}</div>}

      {/* HEADER */}
      <div style={{position:"relative",overflow:"hidden",background:"linear-gradient(160deg,#0f1428,#0a0e1c)",borderBottom:"1px solid rgba(232,192,0,.15)"}}>
        <div style={{position:"absolute",top:-60,right:-60,width:240,height:240,borderRadius:"50%",background:"radial-gradient(circle,rgba(232,192,0,.07),transparent 70%)"}}/>
        <div style={{position:"relative",padding:"20px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:34,letterSpacing:4,color:"#e8c000",lineHeight:1}}>⚽ WC PREDICTOR</div>
            <div style={{fontSize:11,color:"#4a5a7a",marginTop:4,display:"flex",alignItems:"center",gap:8,fontWeight:600}}>
              {Object.keys(users).length} PLAYERS · {matches.length} MATCHES
              <span style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"#44cc88",display:"inline-block",boxShadow:"0 0 6px #44cc88",animation:"pulse 2s ease-in-out infinite"}}/>
                <span style={{color:"#2a4a2a",fontSize:10}}>LIVE · {lastRefresh?lastRefresh.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"…"}</span>
              </span>
              <span style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10}}>{apiSyncing?"⏳":isBlackoutWindow()?"🚫":"⚽"}</span>
                <span style={{color:"#2a3a5a",fontSize:10}}>
                  {apiSyncing?"syncing…":isBlackoutWindow()?"API paused 11–13":"API · "+(lastApiSync?lastApiSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"pending")}
                </span>
              </span>
            </div>
          </div>
          {session?(
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
              <div style={{fontSize:12,color:"#7a8aaa"}}>
                👤 <span style={{color:"#e8c000",fontWeight:700}}>{session}</span>
                {isAdmin&&<span style={{background:isSuperAdmin(session)?"rgba(255,100,0,.2)":"rgba(232,192,0,.15)",color:isSuperAdmin(session)?"#ff8c00":"#e8c000",borderRadius:10,padding:"2px 8px",fontSize:10,marginLeft:6,fontWeight:700}}>{isSuperAdmin(session)?"⚡ SUPER ADMIN":"ADMIN"}</span>}
              </div>
              <button onClick={()=>{setSession(null);setPage("scoreboard");}} style={{background:"rgba(255,80,80,.1)",border:"1px solid rgba(255,80,80,.2)",color:"#ff6666",borderRadius:8,padding:"4px 12px",cursor:"pointer",fontSize:12,fontWeight:600}}>Sign out</button>
            </div>
          ):(
            <button onClick={()=>{setPage("auth");setAuthMode("login");}} style={{background:"#e8c000",color:"#080c18",border:"none",borderRadius:10,padding:"8px 18px",cursor:"pointer",fontWeight:700,fontSize:13}}>Sign in</button>
          )}
        </div>
        <div style={{display:"flex",paddingLeft:4,overflowX:"auto"}}>
          {tabs.map(t=>(
            <button key={t.key} onClick={()=>{setPage(t.key);if(t.key!=="players")setSelectedPlayer(null);}} style={{background:"none",border:"none",borderBottom:page===t.key?"2px solid #e8c000":"2px solid transparent",color:page===t.key?"#e8c000":"#4a5a7a",padding:"10px 16px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13,whiteSpace:"nowrap",transition:"color .15s"}}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{padding:"22px 16px",maxWidth:760,margin:"0 auto"}}>

        {/* ══ SCOREBOARD ══════════════════════════════════════════════════════════ */}
        {page==="scoreboard"&&(
          <div className="fi">
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:"#e8c000",marginBottom:6}}>LEADERBOARD</div>
            <div style={{fontSize:12,color:"#4a5a7a",marginBottom:18,background:"rgba(255,255,255,.03)",borderRadius:10,padding:"10px 14px",lineHeight:1.9}}>
              <span style={{color:"#e8c000",fontWeight:700}}>+1</span> correct outcome &nbsp;·&nbsp;
              <span style={{color:"#44cc88",fontWeight:700}}>+3</span> exact score &nbsp;·&nbsp;
              <span style={{color:"#6699ff",fontWeight:700}}>+1 per scorer</span> correctly guessed (any order)
            </div>
            {leaderboard.length===0&&<div style={{textAlign:"center",color:"#4a5a7a",padding:"40px 0",fontStyle:"italic"}}>No players yet — be the first to sign up!</div>}
            {leaderboard.map((p,i)=>{
              const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
              return(
                <div key={p.name} style={{background:i===0?"linear-gradient(135deg,rgba(232,192,0,.1),rgba(232,192,0,.03))":"rgba(255,255,255,.03)",border:`1px solid ${i===0?"rgba(232,192,0,.25)":"rgba(255,255,255,.06)"}`,borderRadius:12,padding:"14px 18px",marginBottom:8,display:"flex",alignItems:"center",gap:14,animation:`fadeIn .3s ${i*.06}s ease both`}}>
                  <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,width:36,color:i===0?"#e8c000":i===1?"#aaa":i===2?"#cd7f32":"#3a4a6a",textAlign:"center"}}>{medal||`${i+1}`}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:15,color:i===0?"#f0e080":"#c0d0e8"}}>{p.name}</div>
                    <div style={{fontSize:11,color:"#4a5a7a",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                      <span><span style={{color:"#e8c000"}}>{p.outcome}</span> outcome</span>
                      <span><span style={{color:"#44cc88"}}>{p.exact}</span> exact</span>
                      <span><span style={{color:"#6699ff"}}>{p.scorerPts}</span> scorer pts</span>
                      <span style={{color:"#3a4a6a"}}>{p.played} played</span>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:38,color:i===0?"#e8c000":"#5a6a8a",lineHeight:1}}>{p.total}</div>
                    <div style={{fontSize:10,color:"#3a4a6a",letterSpacing:1}}>PTS</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ══ MATCHES ═════════════════════════════════════════════════════════════ */}
        {page==="matches"&&(
          <div className="fi">
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:"#e8c000",marginBottom:16}}>ALL MATCHES</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>
              {phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}
            </div>
            {visibleMatches.map(m=>{
              const hasResult=m.result?.home!=null&&m.result?.home!=="";
              const locked=isPredLocked(m), countdown=timeUntilDeadline(m);
              const allScorers=[...(m.result?.homeScorers||[]),...(m.result?.awayScorers||[])].filter(Boolean);
              return(
                <div key={m.id} style={{background:"rgba(255,255,255,.025)",border:`1px solid ${hasResult?"rgba(68,204,136,.15)":"rgba(255,255,255,.05)"}`,borderRadius:10,padding:"12px 14px",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{minWidth:72}}>
                      <div style={{fontSize:9,color:"#e8c000",fontWeight:700,letterSpacing:1}}>{m.phase}</div>
                      <div style={{fontSize:11,color:"#3a4a6a",fontWeight:600}}>{m.date}</div>
                      {m.kickoffTime&&!hasResult&&<div style={{fontSize:9,color:locked?"#ff6666":countdown?"#44cc88":"#4a5a7a",marginTop:1}}>{locked?"🔒 locked":countdown?`⏳ ${countdown}`:"open"}</div>}
                    </div>
                    <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                    <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:22,color:hasResult?"#e8c000":"#2a3a5a",minWidth:64,textAlign:"center"}}>{hasResult?`${m.result.home} – ${m.result.away}`:"vs"}</div>
                    <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
                  </div>
                  {hasResult&&allScorers.length>0&&<div style={{marginTop:6,fontSize:11,color:"#6699ff"}}>⚽ {allScorers.join(", ")}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* ══ MY PICKS ════════════════════════════════════════════════════════════ */}
        {page==="predict"&&session&&(
          <div className="fi">
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:"#e8c000",marginBottom:6}}>MY PREDICTIONS</div>
            <div style={{fontSize:12,color:"#4a5a7a",marginBottom:16}}>Predictions lock 2h before kickoff. +1 per correct scorer — slots match your predicted score.</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>
              {phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}
            </div>
            {visibleMatches.map(m=>{
              const pred=predictions[session]?.[m.id]||{};
              const pts=calcPoints(pred,m.result);
              const hasResult=m.result?.home!=null&&m.result?.home!=="";
              const locked=hasResult||isPredLocked(m);
              const countdown=timeUntilDeadline(m);
              const ph=parseInt(pred.homeScore)||0, pa=parseInt(pred.awayScore)||0;
              // scorer slots = number of goals per team (capped at 8)
              const homeSlots=Math.min(ph,8), awaySlots=Math.min(pa,8);
              const homeSquad=squads[m.home]||{}, awaySquad=squads[m.away]||{};
              const homePlayers=squadAllPlayers(homeSquad), awayPlayers=squadAllPlayers(awaySquad);
              const homeScorers=pred.homeScorers||[];
              const awayScorers=pred.awayScorers||[];
              return(
                <div key={m.id} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${locked&&!hasResult?"rgba(255,100,0,.2)":hasResult?"rgba(255,255,255,.05)":"rgba(255,255,255,.07)"}`,borderRadius:12,padding:"14px",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div>
                      <span style={{fontSize:10,color:"#e8c000",fontWeight:700,letterSpacing:1}}>{m.phase}</span>
                      <div style={{fontSize:11,color:"#4a5a7a"}}>{m.date}
                        {m.kickoffTime&&!hasResult&&<span style={{marginLeft:8,color:locked?"#ff6666":countdown?"#44cc88":"#7a8aaa"}}>{locked?"🔒 locked":countdown?`⏳ ${countdown}`:"✅ open"}</span>}
                      </div>
                    </div>
                    {pts!==null&&<div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:28,color:pts===0?"#ff4466":pts<=2?"#ffaa00":pts<=4?"#44cc88":"#e8c000"}}>{pts>0?`+${pts}`:"0"} <span style={{fontSize:13,color:"#4a5a7a"}}>pts</span></div>}
                  </div>

                  {/* Score row */}
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                    <input type="number" min="0" max="20" value={pred.homeScore??""} onChange={e=>{setPred(m.id,"homeScore",e.target.value);setPred(m.id,"homeScorers",[]);}} disabled={locked}
                      style={{width:44,textAlign:"center",background:locked?"rgba(255,255,255,.03)":"rgba(232,192,0,.08)",border:`1px solid ${locked?"rgba(255,255,255,.06)":"rgba(232,192,0,.3)"}`,borderRadius:8,padding:"7px 2px",color:"#e8c000",fontSize:18,fontWeight:700}}/>
                    <span style={{color:"#3a4a6a",fontWeight:700}}>–</span>
                    <input type="number" min="0" max="20" value={pred.awayScore??""} onChange={e=>{setPred(m.id,"awayScore",e.target.value);setPred(m.id,"awayScorers",[]);}} disabled={locked}
                      style={{width:44,textAlign:"center",background:locked?"rgba(255,255,255,.03)":"rgba(232,192,0,.08)",border:`1px solid ${locked?"rgba(255,255,255,.06)":"rgba(232,192,0,.3)"}`,borderRadius:8,padding:"7px 2px",color:"#e8c000",fontSize:18,fontWeight:700}}/>
                    <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
                  </div>

                  {/* Scorer slots per team */}
                  {(homeSlots>0||awaySlots>0)&&(
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      {/* Home scorers */}
                      <div>
                        <div style={{fontSize:10,color:"#4a5a7a",fontWeight:700,marginBottom:5}}>⚽ {m.home} scorers ({homeSlots})</div>
                        {Array.from({length:homeSlots}).map((_,si)=>(
                          <div key={si} style={{marginBottom:4}}>
                            <ScorerPicker value={homeScorers[si]||""} onChange={v=>{const arr=[...homeScorers];arr[si]=v;setPred(m.id,"homeScorers",arr);}} squad={homeSquad} placeholder={homePlayers.length?`Goal ${si+1}…`:"No squad set"} disabled={locked||!homePlayers.length}/>
                          </div>
                        ))}
                      </div>
                      {/* Away scorers */}
                      <div>
                        <div style={{fontSize:10,color:"#4a5a7a",fontWeight:700,marginBottom:5}}>⚽ {m.away} scorers ({awaySlots})</div>
                        {Array.from({length:awaySlots}).map((_,si)=>(
                          <div key={si} style={{marginBottom:4}}>
                            <ScorerPicker value={awayScorers[si]||""} onChange={v=>{const arr=[...awayScorers];arr[si]=v;setPred(m.id,"awayScorers",arr);}} squad={awaySquad} placeholder={awayPlayers.length?`Goal ${si+1}…`:"No squad set"} disabled={locked||!awayPlayers.length}/>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasResult&&(
                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.05)",fontSize:12,color:"#4a5a7a"}}>
                      Result: <span style={{color:"#44cc88",fontWeight:700}}>{m.result.home}–{m.result.away}</span>
                      {[...(m.result.homeScorers||[]),...(m.result.awayScorers||[])].filter(Boolean).length>0&&(
                        <span style={{color:"#6699ff",marginLeft:10}}>⚽ {[...(m.result.homeScorers||[]),...(m.result.awayScorers||[])].filter(Boolean).join(", ")}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ══ AUTH ════════════════════════════════════════════════════════════════ */}
        {page==="auth"&&!session&&(
          <div className="fi" style={{maxWidth:320,margin:"0 auto",paddingTop:20}}>
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:28,letterSpacing:3,color:"#e8c000",marginBottom:20}}>{authMode==="login"?"SIGN IN":"CREATE ACCOUNT"}</div>
            <div style={{display:"flex",marginBottom:24,background:"rgba(255,255,255,.04)",borderRadius:10,padding:3}}>
              {["login","register"].map(m=>(
                <button key={m} onClick={()=>{setAuthMode(m);setAuthErr("");setAuthPin("");}} style={{flex:1,background:authMode===m?"#e8c000":"transparent",color:authMode===m?"#080c18":"#4a5a7a",border:"none",borderRadius:8,padding:"8px 0",cursor:"pointer",fontWeight:700,fontSize:13,transition:"all .15s"}}>{m==="login"?"Sign In":"Register"}</button>
              ))}
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:12,color:"#7a8aaa",display:"block",marginBottom:6,fontWeight:600}}>USERNAME</label>
              <input value={authName} onChange={e=>setAuthName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="Your name…"
                style={{width:"100%",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"11px 14px",color:"#f0f0f0",fontSize:15,fontFamily:"'DM Sans',sans-serif"}}/>
            </div>
            <PinPad value={authPin} onChange={setAuthPin} label="4-DIGIT PIN"/>
            {authErr&&<div style={{color:"#ff6666",fontSize:13,marginTop:14,textAlign:"center",fontWeight:600}}>{authErr}</div>}
            <button onClick={handleAuth} style={{width:"100%",marginTop:20,background:authPin.length===4?"#e8c000":"rgba(255,255,255,.06)",color:authPin.length===4?"#080c18":"#4a5a7a",border:"none",borderRadius:12,padding:"14px 0",cursor:authPin.length===4?"pointer":"default",fontWeight:700,fontSize:16,fontFamily:"'DM Sans',sans-serif",transition:"all .2s"}}>{authMode==="login"?"Sign In →":"Create Account →"}</button>
            {authMode==="register"&&Object.keys(users).length===0&&<div style={{marginTop:12,fontSize:11,color:"#4a5a7a",textAlign:"center"}}>First account will be <span style={{color:"#e8c000"}}>admin</span></div>}
          </div>
        )}

        {/* ══ ADMIN ═══════════════════════════════════════════════════════════════ */}
        {/* ══ PLAYERS PAGE ════════════════════════════════════════════════════ */}
        {page==="players"&&(
          <div className="fi">
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:"#e8c000",marginBottom:6}}>PLAYERS</div>
            <div style={{fontSize:12,color:"#4a5a7a",marginBottom:20}}>Pick a player to see all their predictions and points.</div>
            {/* Player selector */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
              {Object.keys(users).map(u=>(
                <button key={u} onClick={()=>setSelectedPlayer(selectedPlayer===u?null:u)} style={{
                  background:selectedPlayer===u?"#e8c000":"rgba(255,255,255,.05)",
                  color:selectedPlayer===u?"#080c18":"#c0d0e8",
                  border:`1px solid ${selectedPlayer===u?"#e8c000":"rgba(255,255,255,.08)"}`,
                  borderRadius:20, padding:"7px 18px", cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif", fontWeight:700, fontSize:13,
                }}>
                  {u}
                  {leaderboard.find(l=>l.name===u)&&(
                    <span style={{marginLeft:8,color:selectedPlayer===u?"#080c18":"#e8c000",fontWeight:700}}>
                      {leaderboard.find(l=>l.name===u).total}pts
                    </span>
                  )}
                </button>
              ))}
            </div>

            {selectedPlayer&&(()=>{
              const lb = leaderboard.find(l=>l.name===selectedPlayer)||{};
              return(
                <div>
                  {/* Summary bar */}
                  <div style={{background:"linear-gradient(135deg,rgba(232,192,0,.1),rgba(232,192,0,.03))",border:"1px solid rgba(232,192,0,.2)",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
                    <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:42,color:"#e8c000",lineHeight:1}}>{lb.total||0}<span style={{fontSize:16,color:"#4a5a7a",marginLeft:4}}>pts</span></div>
                    <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                      <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:24,color:"#e8c000"}}>{lb.outcome||0}</div><div style={{fontSize:10,color:"#4a5a7a"}}>OUTCOME</div></div>
                      <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:24,color:"#44cc88"}}>{lb.exact||0}</div><div style={{fontSize:10,color:"#4a5a7a"}}>EXACT</div></div>
                      <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:24,color:"#6699ff"}}>{lb.scorerPts||0}</div><div style={{fontSize:10,color:"#4a5a7a"}}>SCORER PTS</div></div>
                      <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:24,color:"#7a8aaa"}}>{lb.played||0}</div><div style={{fontSize:10,color:"#4a5a7a"}}>PLAYED</div></div>
                    </div>
                  </div>

                  {/* Phase filter */}
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
                    {phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}
                  </div>

                  {/* Per-match breakdown */}
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {visibleMatches.map(m=>{
                      const pred=predictions[selectedPlayer]?.[m.id];
                      const res=m.result;
                      const hasResult=res?.home!=null&&res?.home!=="";
                      const pts=calcPoints(pred,res);
                      const ptsColor=pts===null?"#2a3a5a":pts===0?"#ff4466":pts<=2?"#ffaa00":pts<=4?"#44cc88":"#e8c000";
                      const allReal=[...(res?.homeScorers||[]),...(res?.awayScorers||[])].filter(Boolean);
                      const allPred=[...(pred?.homeScorers||[]),...(pred?.awayScorers||[])].filter(Boolean);
                      return(
                        <div key={m.id} style={{background:"rgba(255,255,255,.025)",border:`1px solid ${hasResult&&pts!==null?"rgba(255,255,255,.06)":"rgba(255,255,255,.04)"}`,borderRadius:10,padding:"11px 14px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <div style={{minWidth:70}}>
                              <div style={{fontSize:9,color:"#e8c000",fontWeight:700}}>{m.phase}</div>
                              <div style={{fontSize:11,color:"#3a4a6a"}}>{m.date}</div>
                            </div>
                            <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                            {/* Prediction */}
                            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:18,color:"#e8c000",minWidth:50,textAlign:"center"}}>
                              {pred?.homeScore!=null&&pred?.awayScore!=null?`${pred.homeScore}–${pred.awayScore}`:<span style={{color:"#2a3a5a",fontSize:12}}>—</span>}
                            </div>
                            <div style={{fontSize:10,color:"#3a4a6a",padding:"0 4px"}}>→</div>
                            {/* Result */}
                            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:18,color:hasResult?"#44cc88":"#2a3a5a",minWidth:50,textAlign:"center"}}>
                              {hasResult?`${res.home}–${res.away}`:"TBD"}
                            </div>
                            <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
                            {/* Points */}
                            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,color:ptsColor,minWidth:36,textAlign:"right"}}>
                              {pts!==null?`+${pts}`:"—"}
                            </div>
                          </div>
                          {/* Scorers row */}
                          {(allPred.length>0||allReal.length>0)&&(
                            <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.05)",display:"flex",gap:16,fontSize:11,flexWrap:"wrap"}}>
                              {allPred.length>0&&<div style={{color:"#7a8aaa"}}>Guessed: <span style={{color:"#a0b8e8"}}>{allPred.join(", ")}</span></div>}
                              {allReal.length>0&&<div style={{color:"#7a8aaa"}}>Scored: <span style={{color:"#6699ff"}}>{allReal.join(", ")}</span></div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {page==="admin"&&isAdmin&&(
          <div className="fi">
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:"#e8c000",marginBottom:20,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              ADMIN PANEL
              <button onClick={async()=>{setApiSyncing(true);await fetchLiveScores(matches,setMatches);setLastApiSync(new Date());setApiSyncing(false);showToast("Scores synced!");}} style={{background:"rgba(68,204,136,.15)",border:"1px solid rgba(68,204,136,.3)",color:"#44cc88",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:12}}>
                {apiSyncing?"⏳ Syncing…":"⚽ Sync Scores Now"}
              </button>

            </div>

            {/* Results */}
            <div style={{marginBottom:32}}>
              <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:18,letterSpacing:2,color:"#7a8aaa",marginBottom:14}}>ENTER RESULTS</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                {phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}
              </div>
              {visibleMatches.map(m=>{
                const res=m.result||{};
                const rh=parseInt(res.home)||0, ra=parseInt(res.away)||0;
                const homeSlots=Math.min(rh,8), awaySlots=Math.min(ra,8);
                const homeSquad=squads[m.home]||{}, awaySquad=squads[m.away]||{};
              const homePlayers=squadAllPlayers(homeSquad), awayPlayers=squadAllPlayers(awaySquad);
                return(
                  <div key={m.id} style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"13px 14px",marginBottom:8}}>
                    {/* Score + kickoff */}
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <div style={{fontSize:10,color:"#e8c000",fontWeight:700,minWidth:80}}>{m.phase}<br/><span style={{color:"#4a5a7a"}}>{m.date}</span>{m.result?.autoSynced&&<span style={{display:"block",color:"#44cc88",fontSize:9}}>⚽ auto-synced</span>}</div>
                      <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                      <input type="number" min="0" max="20" value={res.home??""} onChange={e=>setMatches(matches.map(x=>x.id===m.id?{...x,result:{...x.result,home:e.target.value,homeScorers:[]}}:x))}
                        style={{width:44,textAlign:"center",background:"rgba(68,204,136,.08)",border:"1px solid rgba(68,204,136,.25)",borderRadius:8,padding:"7px 2px",color:"#44cc88",fontSize:18,fontWeight:700}}/>
                      <span style={{color:"#3a4a6a"}}>–</span>
                      <input type="number" min="0" max="20" value={res.away??""} onChange={e=>setMatches(matches.map(x=>x.id===m.id?{...x,result:{...x.result,away:e.target.value,awayScorers:[]}}:x))}
                        style={{width:44,textAlign:"center",background:"rgba(68,204,136,.08)",border:"1px solid rgba(68,204,136,.25)",borderRadius:8,padding:"7px 2px",color:"#44cc88",fontSize:18,fontWeight:700}}/>
                      <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                      <label style={{fontSize:10,color:"#4a5a7a",fontWeight:600,whiteSpace:"nowrap"}}>⏰ KICKOFF:</label>
                      <input type="datetime-local" value={m.kickoffTime?.slice(0,16)||""} onChange={e=>setMatches(matches.map(x=>x.id===m.id?{...x,kickoffTime:e.target.value}:x))}
                        style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",color:"#c0d0e8",fontSize:11,fontFamily:"'DM Sans',sans-serif"}}/>
                      {m.kickoffTime&&<span style={{fontSize:10,color:isPredLocked(m)?"#ff6666":"#44cc88"}}>{isPredLocked(m)?"🔒 locked":"✅ open"}</span>}
                    </div>
                    {/* Scorer dropdowns per team */}
                    {(homeSlots>0||awaySlots>0)&&(
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:4}}>
                        <div>
                          <div style={{fontSize:10,color:"#44cc88",fontWeight:700,marginBottom:4}}>⚽ {m.home} ({homeSlots} goals)</div>
                          {Array.from({length:homeSlots}).map((_,si)=>(
                            <div key={si} style={{marginBottom:4}}>
                              <ScorerPicker value={(res.homeScorers||[])[si]||""} onChange={v=>{const arr=[...(res.homeScorers||[])];arr[si]=v;setMatches(matches.map(x=>x.id===m.id?{...x,result:{...x.result,homeScorers:arr}}:x));}} squad={homeSquad} placeholder={homePlayers.length?`Goal ${si+1}…`:"No squad — type below"}/>
                            </div>
                          ))}
                          {/* fallback text input if no squad */}
                          {!homePlayers.length&&homeSlots>0&&Array.from({length:homeSlots}).map((_,si)=>(
                            <input key={`ht${si}`} value={(res.homeScorers||[])[si]||""} onChange={e=>{const arr=[...(res.homeScorers||[])];arr[si]=e.target.value;setMatches(matches.map(x=>x.id===m.id?{...x,result:{...x.result,homeScorers:arr}}:x));}} placeholder={`Scorer ${si+1}…`}
                              style={{background:"rgba(100,140,255,.07)",border:"1px solid rgba(100,140,255,.15)",borderRadius:8,padding:"6px 10px",color:"#a0b8e8",fontSize:12,fontFamily:"'DM Sans',sans-serif",width:"100%",marginBottom:4}}/>
                          ))}
                        </div>
                        <div>
                          <div style={{fontSize:10,color:"#44cc88",fontWeight:700,marginBottom:4}}>⚽ {m.away} ({awaySlots} goals)</div>
                          {Array.from({length:awaySlots}).map((_,si)=>(
                            <div key={si} style={{marginBottom:4}}>
                              <ScorerPicker value={(res.awayScorers||[])[si]||""} onChange={v=>{const arr=[...(res.awayScorers||[])];arr[si]=v;setMatches(matches.map(x=>x.id===m.id?{...x,result:{...x.result,awayScorers:arr}}:x));}} squad={awaySquad} placeholder={awayPlayers.length?`Goal ${si+1}…`:"No squad — type below"}/>
                            </div>
                          ))}
                          {!awayPlayers.length&&awaySlots>0&&Array.from({length:awaySlots}).map((_,si)=>(
                            <input key={`at${si}`} value={(res.awayScorers||[])[si]||""} onChange={e=>{const arr=[...(res.awayScorers||[])];arr[si]=e.target.value;setMatches(matches.map(x=>x.id===m.id?{...x,result:{...x.result,awayScorers:arr}}:x));}} placeholder={`Scorer ${si+1}…`}
                              style={{background:"rgba(100,140,255,.07)",border:"1px solid rgba(100,140,255,.15)",borderRadius:8,padding:"6px 10px",color:"#a0b8e8",fontSize:12,fontFamily:"'DM Sans',sans-serif",width:"100%",marginBottom:4}}/>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Squads */}
            <SquadManager squads={squads} setSquads={setSquads} matches={matches} showToast={showToast}/>

            {/* Add match */}
            <div style={{marginBottom:32}}>
              <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:18,letterSpacing:2,color:"#7a8aaa",marginBottom:14}}>ADD MATCH</div>
              <AddMatchForm onAdd={m=>{setMatches(prev=>[...prev,m]);showToast("Match added!");}} nextId={Math.max(...matches.map(m=>m.id))+1}/>
            </div>

            {/* Players */}
            <div>
              <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:18,letterSpacing:2,color:"#7a8aaa",marginBottom:12}}>PLAYERS ({Object.keys(users).length})</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
                {Object.entries(users).map(([name,data])=>(
                  <div key={name} style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13}}>{name}</div>
                      {isSuperAdmin(name)&&<div style={{fontSize:10,color:"#ff8c00"}}>⚡ super admin</div>}
                      {!isSuperAdmin(name)&&data.isAdmin&&<div style={{fontSize:10,color:"#e8c000"}}>admin</div>}
                    </div>
                    {name!==session&&!isSuperAdmin(name)&&(
                      <button onClick={()=>{const u={...users};delete u[name];setUsers(u);showToast(`${name} removed`);}} style={{background:"none",border:"none",color:"#ff4466",cursor:"pointer",fontSize:18}}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Squad Manager ─────────────────────────────────────────────────────────────
function SquadManager({ squads, setSquads, matches, showToast }) {
  const teams = [...new Set(matches.flatMap(m=>[m.home,m.away]).filter(t=>!t.startsWith("TBD")&&!t.match(/^[0-9W]|3rd/)))].sort();
  const [selectedTeam, setSelectedTeam] = useState(teams[0]||"");
  const [newPlayer, setNewPlayer] = useState("");
  const [newPos, setNewPos] = useState("ATT");
  const squad = squads[selectedTeam];
  const isGrouped = isGroupedSquad(squad);
  const grouped = isGrouped ? squad : { GK:[], DEF:[], MID:[], ATT:[] };
  const posLabels = { GK:"🧤 Goalkeepers", DEF:"🛡️ Defenders", MID:"⚙️ Midfielders", ATT:"⚡ Attackers" };
  const posColors = { GK:"#e8c000", DEF:"#44cc88", MID:"#6699ff", ATT:"#ff6644" };
  const totalPlayers = squadAllPlayers(squad).length;

  const addPlayer = () => {
    const p = newPlayer.trim();
    if (!p) return;
    const arr = grouped[newPos]||[];
    if (arr.includes(p)) return;
    setSquads(s=>({...s,[selectedTeam]:{...grouped,[newPos]:[...arr,p]}}));
    showToast(`${p} added to ${newPos}`);
    setNewPlayer("");
  };

  return(
    <div style={{marginBottom:32}}>
      <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:18,letterSpacing:2,color:"#7a8aaa",marginBottom:14}}>SQUAD MANAGEMENT</div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <select value={selectedTeam} onChange={e=>setSelectedTeam(e.target.value)}
          style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px",color:"#f0f0f0",fontSize:13,fontFamily:"'DM Sans',sans-serif",cursor:"pointer"}}>
          {teams.map(t=><option key={t} value={t}>{t} ({squadAllPlayers(squads[t]).length})</option>)}
        </select>
        <span style={{fontSize:11,color:"#4a5a7a"}}>{totalPlayers} players loaded {isGrouped?"(grouped)":"(flat)"}</span>
      </div>

      {/* Add player */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <input value={newPlayer} onChange={e=>setNewPlayer(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&addPlayer()}
          placeholder="Player name…"
          style={{flex:1,minWidth:140,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px",color:"#f0f0f0",fontSize:13,fontFamily:"'DM Sans',sans-serif"}}/>
        <select value={newPos} onChange={e=>setNewPos(e.target.value)}
          style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 10px",color:"#f0f0f0",fontSize:13,fontFamily:"'DM Sans',sans-serif",cursor:"pointer"}}>
          {Object.entries(posLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={addPlayer}
          style={{background:"#e8c000",color:"#080c18",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>+ Add</button>
      </div>

      {/* Players by position */}
      {Object.entries(posLabels).map(([pos, label])=>{
        const players = grouped[pos]||[];
        return(
          <div key={pos} style={{marginBottom:12}}>
            <div style={{fontSize:11,color:posColors[pos],fontWeight:700,marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
              {label} <span style={{color:"#4a5a7a",fontWeight:400}}>({players.length})</span>
            </div>
            {players.length===0
              ? <div style={{fontSize:11,color:"#3a4a6a",fontStyle:"italic",paddingLeft:4}}>None added</div>
              : <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {players.map(p=>(
                    <div key={p} style={{background:`${posColors[pos]}18`,border:`1px solid ${posColors[pos]}33`,borderRadius:16,padding:"3px 10px",fontSize:11,display:"flex",alignItems:"center",gap:5,color:"#c0d0e8"}}>
                      {p}
                      <button onClick={()=>setSquads(s=>({...s,[selectedTeam]:{...grouped,[pos]:players.filter(x=>x!==p)}}))}
                        style={{background:"none",border:"none",color:"#ff4466",cursor:"pointer",fontSize:13,lineHeight:1,padding:0}}>×</button>
                    </div>
                  ))}
                </div>
            }
          </div>
        );
      })}
    </div>
  );
}

function AddMatchForm({ onAdd, nextId }) {
  const [form,setForm]=useState({phase:"Group A",home:"",away:"",date:"",kickoffTime:""});
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(
    <div style={{background:"rgba(255,255,255,.02)",border:"1px dashed rgba(255,255,255,.1)",borderRadius:12,padding:"16px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        {[["home","Home team"],["away","Away team"],["phase","Phase / Group"],["date","Date label"]].map(([k,pl])=>(
          <input key={k} value={form[k]} onChange={e=>f(k,e.target.value)} placeholder={pl}
            style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:8,padding:"9px 12px",color:"#f0f0f0",fontSize:13,fontFamily:"'DM Sans',sans-serif"}}/>
        ))}
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
        <label style={{fontSize:11,color:"#4a5a7a",fontWeight:600,whiteSpace:"nowrap"}}>⏰ Kickoff:</label>
        <input type="datetime-local" value={form.kickoffTime} onChange={e=>f("kickoffTime",e.target.value)}
          style={{flex:1,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:8,padding:"8px 10px",color:"#c0d0e8",fontSize:12,fontFamily:"'DM Sans',sans-serif"}}/>
      </div>
      <button onClick={()=>{if(!form.home||!form.away)return;onAdd({id:nextId,...form,kickoffTime:form.kickoffTime||undefined});setForm({phase:"Group A",home:"",away:"",date:"",kickoffTime:""}); }}
        style={{width:"100%",background:"#e8c000",color:"#080c18",border:"none",borderRadius:8,padding:"9px 0",cursor:"pointer",fontWeight:700,fontSize:13}}>+ Add Match</button>
    </div>
  );
}
