import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue } from "firebase/database";

// ─── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBFxGS0pJ5vZJfuGnuUxSxOtfMJzQlJ1Mc",
  authDomain: "wc-predictor-be5d6.firebaseapp.com",
  databaseURL: "https://wc-predictor-be5d6-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "wc-predictor-be5d6",
  storageBucket: "wc-predictor-be5d6.firebasestorage.app",
  messagingSenderId: "992619654816",
  appId: "1:992619654816:web:66ba86c34034b09955e3c5"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

async function fbGet(path) {
  try { const s = await get(ref(db, path)); return s.exists() ? s.val() : null; } catch { return null; }
}
async function fbSet(path, val) {
  try { await set(ref(db, path), val); } catch(e) { console.error(e); }
}
function fbListen(path, cb) {
  const r = ref(db, path);
  const unsub = onValue(r, s => cb(s.exists() ? s.val() : null));
  return unsub;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const SUPER_ADMINS = ["Faisal", "العم"];
const isSuperAdmin = n => SUPER_ADMINS.includes(n);

function isPredLocked(m) {
  if (!m.kickoffTime) return false;
  return Date.now() >= new Date(m.kickoffTime).getTime() - 90 * 60 * 1000;
}
function timeUntilDeadline(m) {
  if (!m.kickoffTime) return null;
  const diff = new Date(m.kickoffTime).getTime() - 90*60*1000 - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff/3600000), mn = Math.floor((diff%3600000)/60000);
  return h > 0 ? `${h}h ${mn}m` : `${mn}m`;
}

function calcPoints(pred, result) {
  if (!result || result.home==null || result.home==="" || result.away==null || result.away==="") return null;
  const rh=parseInt(result.home), ra=parseInt(result.away), ph=parseInt(pred?.homeScore), pa=parseInt(pred?.awayScore);
  if (isNaN(ph)||isNaN(pa)) return null;
  let pts = 0;
  if ((ph>pa?"H":ph<pa?"A":"D")===(rh>ra?"H":rh<ra?"A":"D")) pts += 1;
  if (ph===rh && pa===ra) pts += 3;
  // Scorer points: each real goal can only be matched once (exact name match).
  // Predicting a player N times only earns points up to the number of goals they actually scored.
  const norm=s=>s.toLowerCase().trim().replace(/\s+/g," ");
  const realPool=(result.homeScorers||[]).concat(result.awayScorers||[]).map(norm).filter(Boolean);
  const predList=(pred?.homeScorers||[]).concat(pred?.awayScorers||[]).map(norm).filter(Boolean);
  const remaining=[...realPool]; // consumable copy
  predList.forEach(p=>{
    if(!p) return;
    const idx=remaining.indexOf(p); // exact match only
    if(idx!==-1){ pts+=1; remaining.splice(idx,1); } // consume that goal
  });
  return pts;
}
function squadAllPlayers(sq) {
  if (!sq) return [];
  if (Array.isArray(sq)) return sq;
  return [...(sq.GK||[]),...(sq.DEF||[]),...(sq.MID||[]),...(sq.ATT||[])];
}
function isGroupedSquad(sq) { return sq && !Array.isArray(sq) && typeof sq==="object"; }

// ─── Matches ───────────────────────────────────────────────────────────────────
const DEFAULT_MATCHES = [
    {id:1,phase:"Group A",home:"Mexico 🇲🇽",away:"South Africa 🇿🇦",date:"Jun 11",kickoffTime:"2026-06-11T22:00+03:00"},
  {id:2,phase:"Group A",home:"South Korea 🇰🇷",away:"Czechia 🇨🇿",date:"Jun 12",kickoffTime:"2026-06-12T01:00+03:00"},
  {id:3,phase:"Group A",home:"Mexico 🇲🇽",away:"South Korea 🇰🇷",date:"Jun 19",kickoffTime:"2026-06-19T04:00+03:00"},
  {id:4,phase:"Group A",home:"Czechia 🇨🇿",away:"South Africa 🇿🇦",date:"Jun 18",kickoffTime:"2026-06-18T19:00+03:00"},
  {id:5,phase:"Group A",home:"Czechia 🇨🇿",away:"Mexico 🇲🇽",date:"Jun 25",kickoffTime:"2026-06-25T04:00+03:00"},
  {id:6,phase:"Group A",home:"South Africa 🇿🇦",away:"South Korea 🇰🇷",date:"Jun 25",kickoffTime:"2026-06-25T04:00+03:00"},
  {id:7,phase:"Group B",home:"Canada 🇨🇦",away:"Bosnia & Herz. 🇧🇦",date:"Jun 13",kickoffTime:"2026-06-13T01:00+03:00"},
  {id:8,phase:"Group B",home:"Qatar 🇶🇦",away:"Switzerland 🇨🇭",date:"Jun 13",kickoffTime:"2026-06-13T22:00+03:00"},
  {id:9,phase:"Group B",home:"Canada 🇨🇦",away:"Qatar 🇶🇦",date:"Jun 19",kickoffTime:"2026-06-19T01:00+03:00"},
  {id:10,phase:"Group B",home:"Switzerland 🇨🇭",away:"Bosnia & Herz. 🇧🇦",date:"Jun 18",kickoffTime:"2026-06-18T22:00+03:00"},
  {id:11,phase:"Group B",home:"Switzerland 🇨🇭",away:"Canada 🇨🇦",date:"Jun 24",kickoffTime:"2026-06-24T22:00+03:00"},
  {id:12,phase:"Group B",home:"Bosnia & Herz. 🇧🇦",away:"Qatar 🇶🇦",date:"Jun 24",kickoffTime:"2026-06-24T22:00+03:00"},
  {id:13,phase:"Group C",home:"Brazil 🇧🇷",away:"Morocco 🇲🇦",date:"Jun 14",kickoffTime:"2026-06-14T01:00+03:00"},
  {id:14,phase:"Group C",home:"Haiti 🇭🇹",away:"Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿",date:"Jun 14",kickoffTime:"2026-06-14T04:00+03:00"},
  {id:15,phase:"Group C",home:"Brazil 🇧🇷",away:"Haiti 🇭🇹",date:"Jun 20",kickoffTime:"2026-06-20T04:00+03:00"},
  {id:16,phase:"Group C",home:"Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿",away:"Morocco 🇲🇦",date:"Jun 19",kickoffTime:"2026-06-19T22:00+03:00"},
  {id:17,phase:"Group C",home:"Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿",away:"Brazil 🇧🇷",date:"Jun 25",kickoffTime:"2026-06-25T01:00+03:00"},
  {id:18,phase:"Group C",home:"Morocco 🇲🇦",away:"Haiti 🇭🇹",date:"Jun 25",kickoffTime:"2026-06-25T01:00+03:00"},
  {id:19,phase:"Group D",home:"USA 🇺🇸",away:"Paraguay 🇵🇾",date:"Jun 13",kickoffTime:"2026-06-13T04:00+03:00"},
  {id:20,phase:"Group D",home:"Australia 🇦🇺",away:"Turkey 🇹🇷",date:"Jun 14",kickoffTime:"2026-06-14T07:00+03:00"},
  {id:21,phase:"Group D",home:"USA 🇺🇸",away:"Australia 🇦🇺",date:"Jun 19",kickoffTime:"2026-06-19T22:00+03:00"},
  {id:22,phase:"Group D",home:"Turkey 🇹🇷",away:"Paraguay 🇵🇾",date:"Jun 20",kickoffTime:"2026-06-20T07:00+03:00"},
  {id:23,phase:"Group D",home:"Turkey 🇹🇷",away:"USA 🇺🇸",date:"Jun 26",kickoffTime:"2026-06-26T04:00+03:00"},
  {id:24,phase:"Group D",home:"Paraguay 🇵🇾",away:"Australia 🇦🇺",date:"Jun 26",kickoffTime:"2026-06-26T04:00+03:00"},
  {id:25,phase:"Group E",home:"Germany 🇩🇪",away:"Curaçao 🇨🇼",date:"Jun 14",kickoffTime:"2026-06-14T20:00+03:00"},
  {id:26,phase:"Group E",home:"Ivory Coast 🇨🇮",away:"Ecuador 🇪🇨",date:"Jun 15",kickoffTime:"2026-06-15T02:00+03:00"},
  {id:27,phase:"Group E",home:"Germany 🇩🇪",away:"Ivory Coast 🇨🇮",date:"Jun 20",kickoffTime:"2026-06-20T23:00+03:00"},
  {id:28,phase:"Group E",home:"Ecuador 🇪🇨",away:"Curaçao 🇨🇼",date:"Jun 21",kickoffTime:"2026-06-21T03:00+03:00"},
  {id:29,phase:"Group E",home:"Ecuador 🇪🇨",away:"Germany 🇩🇪",date:"Jun 25",kickoffTime:"2026-06-25T23:00+03:00"},
  {id:30,phase:"Group E",home:"Curaçao 🇨🇼",away:"Ivory Coast 🇨🇮",date:"Jun 25",kickoffTime:"2026-06-25T23:00+03:00"},
  {id:31,phase:"Group F",home:"Netherlands 🇳🇱",away:"Japan 🇯🇵",date:"Jun 14",kickoffTime:"2026-06-14T23:00+03:00"},
  {id:32,phase:"Group F",home:"Sweden 🇸🇪",away:"Tunisia 🇹🇳",date:"Jun 15",kickoffTime:"2026-06-15T05:00+03:00"},
  {id:33,phase:"Group F",home:"Japan 🇯🇵",away:"Sweden 🇸🇪",date:"Jun 26",kickoffTime:"2026-06-26T02:00+03:00"},
  {id:34,phase:"Group F",home:"Netherlands 🇳🇱",away:"Sweden 🇸🇪",date:"Jun 20",kickoffTime:"2026-06-20T20:00+03:00"},
  {id:35,phase:"Group F",home:"Tunisia 🇹🇳",away:"Japan 🇯🇵",date:"Jun 21",kickoffTime:"2026-06-21T07:00+03:00"},
  {id:36,phase:"Group F",home:"Netherlands 🇳🇱",away:"Tunisia 🇹🇳",date:"Jun 26",kickoffTime:"2026-06-26T02:00+03:00"},
  {id:37,phase:"Group G",home:"Belgium 🇧🇪",away:"Egypt 🇪🇬",date:"Jun 15",kickoffTime:"2026-06-15T22:00+03:00"},
  {id:38,phase:"Group G",home:"Iran 🇮🇷",away:"New Zealand 🇳🇿",date:"Jun 16",kickoffTime:"2026-06-16T04:00+03:00"},
  {id:39,phase:"Group G",home:"Belgium 🇧🇪",away:"Iran 🇮🇷",date:"Jun 21",kickoffTime:"2026-06-21T22:00+03:00"},
  {id:40,phase:"Group G",home:"New Zealand 🇳🇿",away:"Egypt 🇪🇬",date:"Jun 22",kickoffTime:"2026-06-22T04:00+03:00"},
  {id:41,phase:"Group G",home:"Egypt 🇪🇬",away:"Iran 🇮🇷",date:"Jun 27",kickoffTime:"2026-06-27T06:00+03:00"},
  {id:42,phase:"Group G",home:"New Zealand 🇳🇿",away:"Belgium 🇧🇪",date:"Jun 27",kickoffTime:"2026-06-27T06:00+03:00"},
  {id:43,phase:"Group H",home:"Spain 🇪🇸",away:"Cape Verde 🇨🇻",date:"Jun 15",kickoffTime:"2026-06-15T19:00+03:00"},
  {id:44,phase:"Group H",home:"Saudi Arabia 🇸🇦",away:"Uruguay 🇺🇾",date:"Jun 16",kickoffTime:"2026-06-16T01:00+03:00"},
  {id:45,phase:"Group H",home:"Spain 🇪🇸",away:"Saudi Arabia 🇸🇦",date:"Jun 21",kickoffTime:"2026-06-21T19:00+03:00"},
  {id:46,phase:"Group H",home:"Uruguay 🇺🇾",away:"Cape Verde 🇨🇻",date:"Jun 22",kickoffTime:"2026-06-22T01:00+03:00"},
  {id:47,phase:"Group H",home:"Cape Verde 🇨🇻",away:"Saudi Arabia 🇸🇦",date:"Jun 27",kickoffTime:"2026-06-27T03:00+03:00"},
  {id:48,phase:"Group H",home:"Uruguay 🇺🇾",away:"Spain 🇪🇸",date:"Jun 27",kickoffTime:"2026-06-27T03:00+03:00"},
  {id:49,phase:"Group I",home:"France 🇫🇷",away:"Senegal 🇸🇳",date:"Jun 16",kickoffTime:"2026-06-16T22:00+03:00"},
  {id:50,phase:"Group I",home:"Iraq 🇮🇶",away:"Norway 🇳🇴",date:"Jun 17",kickoffTime:"2026-06-17T01:00+03:00"},
  {id:51,phase:"Group I",home:"France 🇫🇷",away:"Iraq 🇮🇶",date:"Jun 23",kickoffTime:"2026-06-23T00:00+03:00"},
  {id:52,phase:"Group I",home:"Norway 🇳🇴",away:"Senegal 🇸🇳",date:"Jun 23",kickoffTime:"2026-06-23T03:00+03:00"},
  {id:53,phase:"Group I",home:"Norway 🇳🇴",away:"France 🇫🇷",date:"Jun 26",kickoffTime:"2026-06-26T22:00+03:00"},
  {id:54,phase:"Group I",home:"Senegal 🇸🇳",away:"Iraq 🇮🇶",date:"Jun 26",kickoffTime:"2026-06-26T22:00+03:00"},
  {id:55,phase:"Group J",home:"Argentina 🇦🇷",away:"Algeria 🇩🇿",date:"Jun 17",kickoffTime:"2026-06-17T04:00+03:00"},
  {id:56,phase:"Group J",home:"Austria 🇦🇹",away:"Jordan 🇯🇴",date:"Jun 17",kickoffTime:"2026-06-17T07:00+03:00"},
  {id:57,phase:"Group J",home:"Argentina 🇦🇷",away:"Austria 🇦🇹",date:"Jun 22",kickoffTime:"2026-06-22T20:00+03:00"},
  {id:58,phase:"Group J",home:"Jordan 🇯🇴",away:"Algeria 🇩🇿",date:"Jun 23",kickoffTime:"2026-06-23T06:00+03:00"},
  {id:59,phase:"Group J",home:"Algeria 🇩🇿",away:"Austria 🇦🇹",date:"Jun 28",kickoffTime:"2026-06-28T00:00+03:00"},
  {id:60,phase:"Group J",home:"Jordan 🇯🇴",away:"Argentina 🇦🇷",date:"Jun 28",kickoffTime:"2026-06-28T00:00+03:00"},
  {id:61,phase:"Group K",home:"Portugal 🇵🇹",away:"DR Congo 🇨🇩",date:"Jun 17",kickoffTime:"2026-06-17T20:00+03:00"},
  {id:62,phase:"Group K",home:"Uzbekistan 🇺🇿",away:"Colombia 🇨🇴",date:"Jun 18",kickoffTime:"2026-06-18T05:00+03:00"},
  {id:63,phase:"Group K",home:"Portugal 🇵🇹",away:"Uzbekistan 🇺🇿",date:"Jun 23",kickoffTime:"2026-06-23T20:00+03:00"},
  {id:64,phase:"Group K",home:"Colombia 🇨🇴",away:"DR Congo 🇨🇩",date:"Jun 24",kickoffTime:"2026-06-24T05:00+03:00"},
  {id:65,phase:"Group K",home:"Colombia 🇨🇴",away:"Portugal 🇵🇹",date:"Jun 28",kickoffTime:"2026-06-28T02:30+03:00"},
  {id:66,phase:"Group K",home:"DR Congo 🇨🇩",away:"Uzbekistan 🇺🇿",date:"Jun 28",kickoffTime:"2026-06-28T02:30+03:00"},
  {id:67,phase:"Group L",home:"England 🏴󠁧󠁢󠁥󠁮󠁧󠁿",away:"Croatia 🇭🇷",date:"Jun 17",kickoffTime:"2026-06-17T23:00+03:00"},
  {id:68,phase:"Group L",home:"Ghana 🇬🇭",away:"Panama 🇵🇦",date:"Jun 18",kickoffTime:"2026-06-18T02:00+03:00"},
  {id:69,phase:"Group L",home:"England 🏴󠁧󠁢󠁥󠁮󠁧󠁿",away:"Ghana 🇬🇭",date:"Jun 23",kickoffTime:"2026-06-23T23:00+03:00"},
  {id:70,phase:"Group L",home:"Panama 🇵🇦",away:"Croatia 🇭🇷",date:"Jun 24",kickoffTime:"2026-06-24T02:00+03:00"},
  {id:71,phase:"Group L",home:"Panama 🇵🇦",away:"England 🏴󠁧󠁢󠁥󠁮󠁧󠁿",date:"Jun 28",kickoffTime:"2026-06-28T00:00+03:00"},
  {id:72,phase:"Group L",home:"Croatia 🇭🇷",away:"Ghana 🇬🇭",date:"Jun 28",kickoffTime:"2026-06-28T00:00+03:00"},
  {id:73,phase:"Round of 32",home:"1A",away:"2B",date:"Jun 29",kickoffTime:"2026-06-29T03:00+03:00"},
  {id:74,phase:"Round of 32",home:"1B",away:"2A",date:"Jun 29",kickoffTime:"2026-06-29T03:00+03:00"},
  {id:75,phase:"Round of 32",home:"1C",away:"2D",date:"Jun 30",kickoffTime:"2026-06-30T01:00+03:00"},
  {id:76,phase:"Round of 32",home:"1D",away:"2C",date:"Jun 30",kickoffTime:"2026-06-30T01:00+03:00"},
  {id:77,phase:"Round of 32",home:"1E",away:"2F",date:"Jul 1",kickoffTime:"2026-07-01T01:00+03:00"},
  {id:78,phase:"Round of 32",home:"1F",away:"2E",date:"Jul 1",kickoffTime:"2026-07-01T01:00+03:00"},
  {id:79,phase:"Round of 32",home:"1G",away:"2H",date:"Jul 2",kickoffTime:"2026-07-02T01:00+03:00"},
  {id:80,phase:"Round of 32",home:"1H",away:"2G",date:"Jul 2",kickoffTime:"2026-07-02T01:00+03:00"},
  {id:81,phase:"Round of 32",home:"1I",away:"2J",date:"Jul 3",kickoffTime:"2026-07-03T01:00+03:00"},
  {id:82,phase:"Round of 32",home:"1J",away:"2I",date:"Jul 3",kickoffTime:"2026-07-03T01:00+03:00"},
  {id:83,phase:"Round of 32",home:"1K",away:"2L",date:"Jul 4",kickoffTime:"2026-07-04T01:00+03:00"},
  {id:84,phase:"Round of 32",home:"1L",away:"2K",date:"Jul 4",kickoffTime:"2026-07-04T01:00+03:00"},
  {id:85,phase:"Round of 32",home:"3rd best 1",away:"3rd best 2",date:"Jul 5",kickoffTime:"2026-07-05T01:00+03:00"},
  {id:86,phase:"Round of 32",home:"3rd best 3",away:"3rd best 4",date:"Jul 5",kickoffTime:"2026-07-05T01:00+03:00"},
  {id:87,phase:"Round of 32",home:"W73",away:"W74",date:"Jul 5",kickoffTime:"2026-07-05T01:00+03:00"},
  {id:88,phase:"Round of 32",home:"W75",away:"W76",date:"Jul 6",kickoffTime:"2026-07-06T01:00+03:00"},
  {id:89,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 7",kickoffTime:"2026-07-07T23:00+03:00"},
  {id:90,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 7",kickoffTime:"2026-07-08T03:00+03:00"},
  {id:91,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 8",kickoffTime:"2026-07-08T23:00+03:00"},
  {id:92,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 8",kickoffTime:"2026-07-09T03:00+03:00"},
  {id:93,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 9",kickoffTime:"2026-07-09T23:00+03:00"},
  {id:94,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 9",kickoffTime:"2026-07-10T03:00+03:00"},
  {id:95,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 10",kickoffTime:"2026-07-10T23:00+03:00"},
  {id:96,phase:"Round of 16",home:"TBD",away:"TBD",date:"Jul 10",kickoffTime:"2026-07-11T03:00+03:00"},
  {id:97,phase:"Quarter-Final",home:"TBD",away:"TBD",date:"Jul 14",kickoffTime:"2026-07-16T23:00+03:00"},
  {id:98,phase:"Quarter-Final",home:"TBD",away:"TBD",date:"Jul 14",kickoffTime:"2026-07-17T22:00+03:00"},
  {id:99,phase:"Quarter-Final",home:"TBD",away:"TBD",date:"Jul 15",kickoffTime:"2026-07-18T00:00+03:00"},
  {id:100,phase:"Quarter-Final",home:"TBD",away:"TBD",date:"Jul 15",kickoffTime:"2026-07-18T04:00+03:00"},
  {id:101,phase:"Semi-Final",home:"TBD",away:"TBD",date:"Jul 18",kickoffTime:"2026-07-21T22:00+03:00"},
  {id:102,phase:"Semi-Final",home:"TBD",away:"TBD",date:"Jul 19",kickoffTime:"2026-07-22T22:00+03:00"},
  {id:103,phase:"Third Place",home:"TBD",away:"TBD",date:"Jul 22",kickoffTime:"2026-07-25T23:00+03:00"},
  {id:104,phase:"Final",home:"TBD",away:"TBD",date:"Jul 26",kickoffTime:"2026-07-26T22:00+03:00"},
];

const DEFAULT_SQUADS = {
  "Mexico 🇲🇽":{GK:["Guillermo Ochoa","Raul Rangel","Carlos Acevedo"],DEF:["Jesus Gallardo","Cesar Montes","Jorge Sanchez","Johan Vasquez","Israel Reyes","Mateo Chavez"],MID:["Edson Alvarez","Orbelin Pineda","Roberto Alvarado","Luis Romo","Luis Chavez","Erik Lira","Gilberto Mora","Brian Gutierrez","Obed Vargas","Alvaro Fidalgo"],ATT:["Raul Jimenez","Alexis Vega","Santiago Gimenez","Cesar Huerta","Julian Quinones","Guillermo Martinez","Armando Gonzalez"]},
  "South Africa 🇿🇦":{GK:["Ronwen Williams","Ricardo Goss","Sipho Chaine"],DEF:["Aubrey Modiba","Khuliso Mudau","Nkosinathi Sibisi","Mbekezeli Mbokazi","Ime Okon","Samukele Kabini","Khulumani Ndamane","Thabang Matuludi","Kamogelo Sebelebele","Bradley Cross","Olwethu Makhanya"],MID:["Teboho Mokoena","Sphephelo Sithole","Thalente Mbatha","Jayden Adams"],ATT:["Themba Zwane","Lyle Foster","Evidence Makgopa","Oswin Appollis","Iqraam Rayners","Relebohile Mofokeng","Thapelo Maseko","Tshepang Moremi"]},
  "South Korea 🇰🇷":{GK:["Kim Seung-gyu","Jo Hyeon-woo","Song Bum-keun"],DEF:["Kim Min-jae","Kim Moon-hwan","Seol Young-woo","Lee Tae-seok","Park Jin-seob","Kim Tae-hyeon","Lee Han-beom","Jens Castrop","Lee Ki-hyuk","Cho Wi-je"],MID:["Lee Jae-sung","Hwang Hee-chan","Hwang In-beom","Lee Kang-in","Paik Seung-ho","Kim Jin-gyu","Lee Dong-gyeong","Bae Jun-ho","Eom Ji-sung","Yang Hyun-jun"],ATT:["Son Heung-min","Cho Gue-sung","Oh Hyeon-gyu"]},
  "Czechia 🇨🇿":{GK:["Matej Kovar","Jindrich Stanek","Lukas Hornicek"],DEF:["Vladimir Coufal","Tomas Holes","Ladislav Krejci","David Zima","Jaroslav Zeleny","David Jurasek","David Doudera","Robin Hranac","Stepan Chaloupek"],MID:["Tomas Soucek","Vladimir Darida","Lukas Provod","Michal Sadilek","Pavel Sulc","Lukas Cerv","Hugo Sochurek","Alexandr Sojka","Denis Visinsky"],ATT:["Patrik Schick","Adam Hlozek","Jan Kuchta","Mojmir Chytil","Tomas Chory"]},
  "Canada 🇨🇦":{GK:["Dayne St. Clair","Maxime Crepeau","Owen Goodman"],DEF:["Alistair Johnston","Luc de Fougerolles","Alfie Jones","Joel Waterman","Derek Cornelius","Moise Bombito","Alphonso Davies","Richie Laryea","Niko Sigur"],MID:["Mathieu Choiniere","Stephen Eustaquio","Ismael Kone","Liam Millar","Jacob Shaffelburg","Jonathan Osorio","Ali Ahmed","Nathan Saliba","Tajon Buchanan","Marcelo Flores"],ATT:["Cyle Larin","Jonathan David","Tani Oluwaseyi","Promise David"]},
  "Switzerland 🇨🇭":{GK:["Gregor Kobel","Yvon Mvogo","Marvin Keller"],DEF:["Miro Muheim","Silvan Widmer","Nico Elvedi","Manuel Akanji","Ricardo Rodriguez","Eray Comert","Aurele Amenda","Luca Jaquez"],MID:["Denis Zakaria","Remo Freuler","Johan Manzambi","Granit Xhaka","Ardon Jashari","Djibril Sow","Christian Fassnacht","Michel Aebischer","Fabian Rieder"],ATT:["Breel Embolo","Dan Ndoye","Noah Okafor","Ruben Vargas","Zeki Amdouni","Cedric Itten"]},
  "Qatar 🇶🇦":{GK:["Mahmoud Abunada","Salah Zakaria","Meshaal Barsham"],DEF:["Pedro Miguel","Lucas Mendes","Issa Laye","Ayoub Al Alawi","Boualem Khoukhi","Sultan Al Brake","Al Hashmi Al Hussain","Homam Ahmed"],MID:["Jassem Gaber","Abdulaziz Hatem","Karim Boudiaf","Assim Madibo","Ahmed Fathi","Mohamed Al-Mannai"],ATT:["Ahmed Alaaeldin","Edmilson Junior","Mohammed Muntari","Hassan Al-Haydos","Akram Afif","Yusuf Abdurisag","Ahmed Al-Ganehi","Almoez Ali","Tahsin Jamshid"]},
  "Bosnia & Herz. 🇧🇦":{GK:["Nikola Vasilj","Martin Zlomislic","Osman Hadzikic"],DEF:["Sead Kolasinac","Dennis Hadzikadunic","Amar Dedic","Nikola Katic","Tarik Muharemovic","Nihad Mujakic","Stjepan Radeljic","Nidal Celik"],MID:["Amir Hadziahmetovic","Benjamin Tahirovic","Armin Gigovic","Dzenis Burnic","Ivan Basic","Esmir Bajraktarevic","Amar Memic","Ivan Sunjic","Kerim Alajbegovic","Ermin Mahmic"],ATT:["Edin Dzeko","Ermedin Demirovic","Samed Bazdar","Haris Tabakovic","Jovo Lukic"]},
  "Brazil 🇧🇷":{GK:["Alisson","Weverton","Ederson"],DEF:["Wesley","Gabriel Magalhaes","Marquinhos","Alex Sandro","Danilo Luiz","Bremer","Leo Pereira","Douglas Santos","Roger Ibanez"],MID:["Casemiro","Bruno Guimaraes","Fabinho","Danilo Santos","Lucas Paqueta"],ATT:["Vinicius Junior","Matheus Cunha","Neymar","Raphinha","Endrick","Luiz Henrique","Gabriel Martinelli","Igor Thiago","Rayan"]},
  "Morocco 🇲🇦":{GK:["Yassine Bounou","Munir Mohamedi","Ahmed Reda Tagnaouti"],DEF:["Achraf Hakimi","Nayef Aguerd","Noussair Mazraoui","Youssef Belammari","Anass Salah-Eddine","Chadi Riad","Issa Diop","Zakaria El Ouahdi","Redouane Halhal"],MID:["Sofyan Amrabat","Azzedine Ounahi","Bilal El Khannouss","Ismael Saibari","Neil El Aynaoui","Samir El Mourabet","Ayyoub Bouaddi"],ATT:["Ayoub El Kaabi","Soufiane Rahimi","Abde Ezzalzouli","Brahim Diaz","Chemsdine Talbi","Gessime Yassine","Ayoube Amaimouni"]},
  "Haiti 🇭🇹":{GK:["Johny Placide","Alexandre Pierre","Josue Duverger"],DEF:["Ricardo Ade","Carlens Arcus","Martin Experience","Jean-Kevin Duverne","Duke Lacroix","Wilguens Paugain","Hannes Delcroix","Keeto Thermoncy"],MID:["Leverton Pierre","Danley Jean Jacques","Carl Sainte","Jean-Ricner Bellegarde","Woodensky Pierre","Dominique Simon"],ATT:["Duckens Nazon","Frantzdy Pierrot","Derrick Etienne Jr.","Louicius Deedson","Ruben Providence","Josue Casimir","Yassin Fortune","Wilson Isidor","Lenny Joseph"]},
  "Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿":{GK:["Craig Gordon","Angus Gunn","Liam Kelly"],DEF:["Andy Robertson","Grant Hanley","Kieran Tierney","Scott McKenna","Jack Hendry","Nathan Patterson","Anthony Ralston","John Souttar","Aaron Hickey","Dominic Hyam"],MID:["John McGinn","Scott McTominay","Ryan Christie","Kenny McLean","Lewis Ferguson","Ben Gannon-Doak","Findlay Curtis","Tyler Fletcher"],ATT:["Lyndon Dykes","Che Adams","Lawrence Shankland","George Hirst","Ross Stewart"]},
  "USA 🇺🇸":{GK:["Matt Turner","Matt Freese","Chris Brady"],DEF:["Sergino Dest","Chris Richards","Antonee Robinson","Auston Trusty","Miles Robinson","Tim Ream","Alex Freeman","Max Arfsten","Mark McKenzie","Joe Scally"],MID:["Tyler Adams","Giovanni Reyna","Weston McKennie","Sebastian Berhalter","Cristian Roldan","Malik Tillman"],ATT:["Ricardo Pepi","Christian Pulisic","Brenden Aaronson","Haji Wright","Folarin Balogun","Timothy Weah","Alejandro Zendejas"]},
  "Paraguay 🇵🇾":{GK:["Gatito Fernandez","Orlando Gill","Gaston Olveira"],DEF:["Gustavo Gomez","Junior Alonso","Fabian Balbuena","Omar Alderete","Juan Jose Caceres","Gustavo Velazquez","Jose Canale","Alexandro Maidana"],MID:["Miguel Almiron","Mauricio","Andres Cubas","Ramon Sosa","Diego Gomez","Damian Bobadilla","Braian Ojeda","Matias Galarza","Gustavo Caballero"],ATT:["Antonio Sanabria","Julio Enciso","Gabriel Avalos","Alex Arce","Isidro Pitta","Ramon Gamarra"]},
  "Turkey 🇹🇷":{GK:["Ugurcan Cakir","Mert Gunok","Altay Bayindir"],DEF:["Merih Demiral","Zeki Celik","Caglar Soyuncu","Mert Muldur","Ferdi Kadioglu","Ozan Kabak","Abdulkerim Bardakci","Eren Elmali","Samet Akaydin"],MID:["Hakan Calhanoglu","Kaan Ayhan","Orkun Kokcu","Ismail Yuksek","Salih Ozcan"],ATT:["Kerem Akturkoglu","Irfan Can Kahveci","Baris Alper Yilmaz","Arda Guler","Kenan Yildiz","Yunus Akgun","Oguz Aydin","Deniz Gul","Can Uzun"]},
  "Australia 🇦🇺":{GK:["Mathew Ryan","Paul Izzo","Patrick Beach"],DEF:["Milos Degenek","Alessandro Circati","Jacob Italiano","Jordan Bos","Jason Geria","Kai Trewin","Aziz Behich","Harry Souttar","Cameron Burgess","Lucas Herrington"],MID:["Connor Metcalfe","Ajdin Hrustic","Aiden O'Neill","Cammy Devlin","Jackson Irvine","Paul Okon-Engstler"],ATT:["Mathew Leckie","Mohamed Toure","Awer Mabil","Nestory Irankunda","Cristian Volpato","Nishan Velupillay","Tete Yengi"]},
  "Germany 🇩🇪":{GK:["Manuel Neuer","Oliver Baumann","Alexander Nubel"],DEF:["Antonio Rudiger","Waldemar Anton","Jonathan Tah","Nico Schlotterbeck","David Raum","Nathaniel Brown","Malick Thiaw"],MID:["Joshua Kimmich","Aleksandar Pavlovic","Leon Goretzka","Jamie Leweling","Jamal Musiala","Pascal Gross","Angelo Stiller","Florian Wirtz","Leroy Sane","Nadiem Amiri","Felix Nmecha","Lennart Karl"],ATT:["Kai Havertz","Nick Woltemade","Maximilian Beier","Deniz Undav"]},
  "Curaçao 🇨🇼":{GK:["Eloy Room","Tyrick Bodak","Trevor Doornbusch"],DEF:["Shurandy Sambo","Jurien Gaari","Roshon van Eijma","Sherel Floranus","Armando Obispo","Joshua Brenet","Riechedly Bazoer","Deveron Fonville"],MID:["Godfried Roemeratoe","Juninho Bacuna","Livano Comenencia","Leandro Bacuna","Tyrese Noslin","Ar'jany Martha","Kevin Felida"],ATT:["Jurgen Locadia","Jeremy Antonisse","Sontje Hansen","Kenji Gorre","Jearl Margaritha","Brandley Kuwas","Gervane Kastaneer","Tahith Chong"]},
  "Ecuador 🇪🇨":{GK:["Hernan Galindez","Moises Ramirez","Gonzalo Valle"],DEF:["Felix Torres","Piero Hincapie","Joel Ordonez","Willian Pacho","Pervis Estupinan","Angelo Preciado","Jackson Porozo","Yaimar Medina"],MID:["Jordy Alcivar","Denil Castillo","John Yeboah","Kendry Paez","Alan Minda","Pedro Vite","Alan Franco","Moises Caicedo","Gonzalo Plata"],ATT:["Kevin Rodriguez","Enner Valencia","Anthony Valencia","Jordy Caicedo","Nilson Angulo","Jeremy Arevalo"]},
  "Ivory Coast 🇨🇮":{GK:["Yahia Fofana","Alban Lafont","Mohamed Kone"],DEF:["Ghislain Konan","Odilon Kossounou","Wilfried Singo","Evan Ndicka","Emmanuel Agbadou","Guela Doue","Ousmane Diomande","Christopher Operi"],MID:["Franck Kessie","Jean Michael Seri","Ibrahim Sangare","Seko Fofana","Christ Inao Oulai","Parfait Guiagon"],ATT:["Nicolas Pepe","Oumar Diakite","Simon Adingra","Evann Guessand","Amad Diallo","Yan Diomande","Bazoumana Toure","Elye Wahi","Ange-Yoan Bonny"]},
  "Japan 🇯🇵":{GK:["Zion Suzuki","Keisuke Osako","Tomoki Hayakawa"],DEF:["Ko Itakura","Hiroki Ito","Yuto Nagatomo","Ayumu Seko","Yukinari Sugawara","Junnosuke Suzuki","Shogo Taniguchi","Takehiro Tomiyasu","Tsuyoshi Watanabe"],MID:["Ritsu Doan","Wataru Endo","Junya Ito","Daichi Kamada","Takefusa Kubo","Keito Nakamura","Kaishu Sano","Ao Tanaka"],ATT:["Keisuke Goto","Daizen Maeda","Koki Ogawa","Kento Shiogai","Yuito Suzuki","Ayase Ueda"]},
  "Netherlands 🇳🇱":{GK:["Mark Flekken","Robin Roefs","Bart Verbruggen"],DEF:["Nathan Ake","Virgil van Dijk","Denzel Dumfries","Jan Paul van Hecke","Jurrien Timber","Jorrel Hato","Micky van de Ven"],MID:["Ryan Gravenberch","Frenkie de Jong","Teun Koopmeiners","Tijjani Reijnders","Marten de Roon","Guus Til","Quinten Timber","Mats Wieffer"],ATT:["Brian Brobbey","Memphis Depay","Cody Gakpo","Noa Lang","Donyell Malen","Crysencio Summerville","Wout Weghorst","Justin Kluivert"]},
  "Sweden 🇸🇪":{GK:["Viktor Johansson","Kristoffer Nordfeldt","Jacob Zetterstrom"],DEF:["Hjalmar Ekdal","Gabriel Gudmundsson","Isak Hien","Victor Lindelof","Eric Smith","Carl Starfelt","Daniel Svensson","Gustaf Lagerbielke","Elliot Stroud","Herman Johansson"],MID:["Yasin Ayari","Lucas Bergvall","Jesper Karlstrom","Ken Sema","Mattias Svanberg","Besfort Zeneli","Taha Ali","Alexander Bernhardsson"],ATT:["Anthony Elanga","Viktor Gyokeres","Alexander Isak","Gustaf Nilsson","Benjamin Nygren"]},
  "Tunisia 🇹🇳":{GK:["Sabri Ben Hessen","Abdelmouhib Chamakh","Aymen Dahman"],DEF:["Ali Abdi","Adem Arous","Mohamed Amine Ben Hamida","Dylan Bronn","Raed Chikhaoui","Moutaz Neffati","Omar Rekik","Montassar Talbi","Yan Valery"],MID:["Mortadha Ben Ouanes","Anis Ben Slimane","Ismael Gharbi","Rani Khedira","Mohamed Hadj Mahmoud","Hannibal Mejbri","Ellyes Skhiri"],ATT:["Elias Achouri","Khalil Ayari","Firas Chaouat","Rayan Elloumi","Hazem Mastouri","Elias Saad","Sebastian Tounekti"]},
  "Belgium 🇧🇪":{GK:["Thibaut Courtois","Senne Lammens","Mike Penders"],DEF:["Timothy Castagne","Zeno Debast","Maxim De Cuyper","Koni De Winter","Brandon Mechele","Thomas Meunier","Nathan Ngoy","Joaquin Seys","Arthur Theate"],MID:["Kevin De Bruyne","Amadou Onana","Nicolas Raskin","Youri Tielemans","Hans Vanaken","Axel Witsel"],ATT:["Charles De Ketelaere","Jeremy Doku","Matias Fernandez-Pardo","Romelu Lukaku","Dodi Lukebakio","Diego Moreira","Alexis Saelemaekers","Leandro Trossard"]},
  "Egypt 🇪🇬":{GK:["Mohamed El Shenawy","Mostafa Shobeir","El Mahdy Soliman","Mohamed Alaa"],DEF:["Mohamed Abdelmonem","Mohamed Hany","Yasser Ibrahim","Hossam Abdelmaguid","Ahmed Fattouh","Tarek Alaa","Rami Rabia","Karim Hafez"],MID:["Marwan Attia","Ahmed Sayed Zizo","Mahmoud Trezeguet","Emam Ashour","Mostafa Abdel Raouf","Mohannad Lasheen","Haitham Hassan","Mahmoud Saber","Ibrahim Adel","Nabil Emad","Hamdi Fathi"],ATT:["Mohamed Salah","Omar Marmoush","Hamza Abdel Karim"]},
  "Iran 🇮🇷":{GK:["Alireza Beiranvand","Seyed Hossein Hosseini","Payam Niazmand"],DEF:["Danial Eiri","Ehsan Hajsafi","Saleh Hardani","Hossein Kanaani","Shoja Khalilzadeh","Milad Mohammadi","Ali Nemati","Ramin Rezaeian"],MID:["Rouzbeh Cheshmi","Saeid Ezatolahi","Mehdi Ghaedi","Saman Ghoddos","Mohammad Ghorbani","Alireza Jahanbakhsh","Mohammad Mohebi","Amir Mohammad Razzaghinia","Mehdi Torabi","Aria Yousefi"],ATT:["Ali Alipour","Dennis Dargahi","Amirhossein Hosseinzadeh","Mehdi Taremi","Shahriar Moghanlou"]},
  "New Zealand 🇳🇿":{GK:["Max Crocombe","Alex Paulsen","Michael Woud"],DEF:["Tyler Bindon","Michael Boxall","Liberato Cacace","Francis de Vries","Callan Elliot","Tim Payne","Nando Pijnaker","Tommy Smith","Finn Surman"],MID:["Lachlan Bayliss","Joe Bell","Matt Garbett","Eli Just","Callum McCowatt","Ben Old","Alex Rufer","Marko Stamenic","Sarpreet Singh","Ryan Thomas"],ATT:["Kosta Barbarouses","Jesse Randall","Ben Waine","Chris Wood"]},
  "Spain 🇪🇸":{GK:["Unai Simon","David Raya","Joan Garcia"],DEF:["Marc Cucurella","Pau Cubarsi","Aymeric Laporte","Alejandro Grimaldo","Pedro Porro","Eric Garcia","Marcos Llorente","Marc Pubill"],MID:["Gavi","Rodri","Pedri","Martin Zubimendi","Fabian Ruiz","Alex Baena","Mikel Merino"],ATT:["Lamine Yamal","Nico Williams","Dani Olmo","Ferran Torres","Mikel Oyarzabal","Yeremy Pino","Borja Iglesias","Victor Munoz"]},
  "Uruguay 🇺🇾":{GK:["Sergio Rochet","Fernando Muslera","Santiago Mele"],DEF:["Guillermo Varela","Ronald Araujo","Jose Maria Gimenez","Santiago Bueno","Sebastian Caceres","Mathias Olivera","Joaquin Piquerez","Matias Vina"],MID:["Maximiliano Araujo","Giorgian de Arrascaeta","Rodrigo Bentancur","Agustin Canobbio","Nicolas de la Cruz","Emiliano Martinez","Facundo Pellistri","Brian Rodriguez","Juan Manuel Sanabria","Manuel Ugarte","Federico Valverde","Rodrigo Zalazar"],ATT:["Rodrigo Aguirre","Federico Vinas","Darwin Nunez"]},
  "Cape Verde 🇨🇻":{GK:["CJ dos Santos","Marcio Rosa","Vozinha"],DEF:["Sidny Cabral","Diney Borges","Logan Costa","Roberto Pico Lopes","Steven Moreira","Wagner Pina","Kelvin Pires","Joao Paulo Fernandes","Stopira Tavares"],MID:["Telmo Arcanjo","Deroy Duarte","Laros Duarte","Jamiro Monteiro","Kevin Pina","Yannick Semedo"],ATT:["Gilson Benchimol","Jovane Cabral","Dailon Livramento","Ryan Mendes","Nuno da Costa","Garry Rodrigues","Willy Semedo","Helio Varela"]},
  "Saudi Arabia 🇸🇦":{GK:["Nawaf Al Aqidi","Mohamed Al Owais","Ahmed Alkassar"],DEF:["Saud Abdulhamid","Jehad Thakri","Abdulelah Al Amri","Hassan Tambakti","Ali Lajami","Hassan Kadesh","Moteb Al Harbi","Nawaf Boushal","Ali Majrashi","Mohammed Abu Alshamat"],MID:["Ziyad Al Johani","Nasser Al Dawsari","Mohamed Kanno","Abdullah Al Khaibari","Alaa Al Hejji","Musab Al Juwayr","Sultan Mandash","Ayman Yahya","Khalid Al Ghannam"],ATT:["Salem Al Dawsari","Abdullah Al Hamdan","Feras Al Brikan","Saleh Al Shehri"]},
  "France 🇫🇷":{GK:["Mike Maignan","Robin Risser","Brice Samba"],DEF:["Lucas Digne","Malo Gusto","Lucas Hernandez","Theo Hernandez","Ibrahima Konate","Maxence Lacroix","Jules Kounde","William Saliba","Dayot Upamecano"],MID:["N'Golo Kante","Manu Kone","Adrien Rabiot","Aurelien Tchouameni","Warren Zaire-Emery"],ATT:["Maghnes Akliouche","Bradley Barcola","Rayan Cherki","Ousmane Dembele","Desire Doue","Michael Olise","Kylian Mbappe","Jean-Philippe Mateta","Marcus Thuram"]},
  "Senegal 🇸🇳":{GK:["Edouard Mendy","Mory Diaw","Yehvann Diouf"],DEF:["Krepin Diatta","Antoine Mendy","Kalidou Koulibaly","El Hadji Malick Diouf","Mamadou Sarr","Moussa Niakhate","Abdoulaye Seck","Ismail Jakobs"],MID:["Idrissa Gana Gueye","Pape Gueye","Lamine Camara","Habib Diarra","Pathe Ciss","Pape Matar Sarr","Bara Sapoko Ndiaye"],ATT:["Sadio Mane","Ismaila Sarr","Iliman Ndiaye","Assane Diao","Ibrahim Mbaye","Nicolas Jackson","Bamba Dieng","Cherif Ndiaye"]},
  "Norway 🇳🇴":{GK:["Orjan Nyland","Egil Selvik","Sander Tangvik"],DEF:["Kristoffer Ajer","Fredrik Bjorkan","Henrik Falchener","Sondre Langas","Torbjorn Heggem","Marcus Holmgren Pedersen","Julian Ryerson","David Moller Wolfe","Leo Ostigard"],MID:["Thelonious Aasgaard","Fredrik Aursnes","Patrick Berg","Sander Berge","Oscar Bobb","Jens Petter Hauge","Antonio Nusa","Andreas Schjelderup","Morten Thorsby","Kristian Thorstvedt","Martin Odegaard"],ATT:["Erling Haaland","Alexander Sorloth","Jorgen Strand Larsen"]},
  "Iraq 🇮🇶":{GK:["Fahad Talib","Jalal Hassan","Ahmed Basil"],DEF:["Hussein Ali","Manaf Younis","Zaid Tahseen","Rebin Sulaka","Akam Hashem","Merchas Doski","Ahmed Yahya","Zaid Ismail","Frans Putros","Mustafa Saadoon"],MID:["Amir Al Ammari","Kevin Yakob","Zidane Iqbal","Aimar Sher","Ibrahim Bayesh","Ahmed Qasim","Youssef Amyn","Marko Farji"],ATT:["Ali Jassim","Ali Al Hamadi","Ali Yousef","Aymen Hussein","Mohanad Ali"]},
  "Argentina 🇦🇷":{GK:["Emiliano Martinez","Geronimo Rulli","Juan Musso"],DEF:["Leonardo Balerdi","Gonzalo Montiel","Nicolas Tagliafico","Lisandro Martinez","Cristian Romero","Nicolas Otamendi","Facundo Medina","Nahuel Molina"],MID:["Leandro Paredes","Rodrigo De Paul","Valentin Barco","Giovani Lo Celso","Exequiel Palacios","Alexis Mac Allister","Enzo Fernandez"],ATT:["Julian Alvarez","Lionel Messi","Nicolas Gonzalez","Thiago Almada","Giuliano Simeone","Nicolas Paz","Jose Manuel Lopez","Lautaro Martinez"]},
  "Algeria 🇩🇿":{GK:["Oussama Benbot","Melvin Masstil","Luca Zidane"],DEF:["Achraf Abada","Rayan Ait Nouri","Zinedine Belaid","Rafik Belghali","Ramy Bensebaini","Samir Chergui","Jaouen Hadjam","Aissa Mandi","Mohamed Amine Tougai"],MID:["Houssem Aouar","Nabil Bentaleb","Hicham Boudaoui","Fares Chaibi","Ibrahim Maza","Yassine Titraoui","Ramiz Zerrouki"],ATT:["Mohamed Amine Amoura","Nadir Benbouali","Adil Boulbina","Fares Ghedjemis","Amine Gouiri","Riyad Mahrez","Anis Hadj Moussa"]},
  "Austria 🇦🇹":{GK:["Patrick Pentz","Alexander Schlager","Florian Wiegele"],DEF:["David Affengruber","David Alaba","Kevin Danso","Marco Friedl","Philipp Lienhart","Phillipp Mwene","Stefan Posch","Alexander Prass","Michael Svoboda"],MID:["Christoph Baumgartner","Carney Chukwuemeka","Florian Grillitsch","Konrad Laimer","Marcel Sabitzer","Xaver Schlager","Romano Schmid","Alessandro Schopf","Nicolas Seiwald","Paul Wanner","Patrick Wimmer"],ATT:["Marko Arnautovic","Michael Gregoritsch","Sasa Kalajdzic"]},
  "Jordan 🇯🇴":{GK:["Yazid Abulaila","Noor Bani Attiah","Abdallah Al Fakhouri"],DEF:["Mohammad Abu Hashish","Abdullah Nasib","Hussam Abu Dhahab","Yazan Al Arab","Mohammad Abu Alnadi","Salem Obaid","Saed Al Rosan","Ehsan Haddad","Anas Badawi"],MID:["Amer Jamous","Noor Al Rawabdeh","Rajaei Ayed","Ibrahim Sadeh","Mohannad Abu Taha","Nizar Al Rashdan","Mohammad Al Dawoud","Mahmoud Mardahi"],ATT:["Mohammad Abu Zraiq","Ali Olwan","Mousa Al Tamari","Odeh Fakhoury","Ibrahim Sabra","Ali Azaizeh"]},
  "Portugal 🇵🇹":{GK:["Diogo Costa","Jose Sa","Rui Silva"],DEF:["Tomas Araujo","Joao Cancelo","Diogo Dalot","Ruben Dias","Goncalo Inacio","Nuno Mendes","Matheus Nunes","Nelson Semedo","Renato Veiga"],MID:["Samuel Costa","Bruno Fernandes","Joao Neves","Ruben Neves","Bernardo Silva","Vitinha"],ATT:["Francisco Conceicao","Joao Felix","Goncalo Guedes","Rafael Leao","Pedro Neto","Goncalo Ramos","Cristiano Ronaldo","Francisco Trincao"]},
  "Colombia 🇨🇴":{GK:["Camilo Vargas","Alvaro Montero","David Ospina"],DEF:["Davinson Sanchez","Jhon Lucumi","Yerry Mina","Willer Ditta","Daniel Munoz","Santiago Arias","Johan Mojica","Deiver Machado"],MID:["Richard Rios","Jefferson Lerma","Kevin Castano","Juan Camilo Portilla","Gustavo Puerta","Jhon Arias","Jorge Carrascal","Juan Fernando Quintero","James Rodriguez","Jaminton Campaz"],ATT:["Juan Camilo Hernandez","Luis Diaz","Luis Suarez","Carlos Gomez","Jhon Cordoba"]},
  "DR Congo 🇨🇩":{GK:["Matthieu Epolo","Timothy Fayulu","Lionel Mpasi"],DEF:["Dylan Batubinsika","Gedeon Kalulu","Steve Kapuadi","Joris Kayembe","Arthur Masuaku","Chancel Mbemba","Axel Tuanzebe","Aaron Wan-Bissaka"],MID:["Brian Cipenga","Meshack Elia","Gael Kakuta","Edo Kayembe","Nathanael Mbuku","Samuel Moutoussamy","Ngal'ayel Mukau","Charles Pickel","Noah Sadiki","Aaron Tshibola"],ATT:["Cedric Bakambu","Simon Banza","Fiston Mayele","Yoane Wissa","Theo Bongonda"]},
  "Uzbekistan 🇺🇿":{GK:["Botirali Ergashev","Abduvohid Nematov","Utkir Yusupov"],DEF:["Abdukodir Khusanov","Khojiakbar Alijonov","Rustamjon Ashurmatov","Farrukh Sayfiev","Sherzod Nasrullaev","Umarbek Eshmuradov","Avazbek Ulmasaliev","Jakhongir Urozov","Bekhruz Karimov","Abdulla Abdullaev"],MID:["Akmal Mozgovoy","Otabek Shukurov","Jamshid Iskanderov","Odiljon Hamrobekov","Jaloliddin Masharipov","Azizbek Ganiev","Sherzod Esanov","Abbosbek Fayzullaev"],ATT:["Azizbek Amonov","Eldor Shomurodov","Igor Sergeev","Oston Urunov","Dostonbek Hamdamov"]},
  "England 🏴󠁧󠁢󠁥󠁮󠁧󠁿":{GK:["Jordan Pickford","Dean Henderson","James Trafford"],DEF:["Reece James","Ezri Konsa","Jarell Quansah","John Stones","Marc Guehi","Dan Burn","Nico O'Reilly","Djed Spence","Tino Livramento"],MID:["Declan Rice","Elliot Anderson","Kobbie Mainoo","Jordan Henderson","Morgan Rogers","Jude Bellingham","Eberechi Eze"],ATT:["Harry Kane","Ivan Toney","Ollie Watkins","Bukayo Saka","Marcus Rashford","Anthony Gordon","Noni Madueke"]},
  "Croatia 🇭🇷":{GK:["Dominik Livakovic","Dominik Kotarski","Ivor Pandur"],DEF:["Josko Gvardiol","Duje Caleta-Car","Josip Sutalo","Josip Stanisic","Marin Pongracic","Martin Erlic","Luka Vuskovic"],MID:["Luka Modric","Mateo Kovacic","Mario Pasalic","Nikola Vlasic","Luka Sucic","Martin Baturina","Kristijan Jakic","Petar Sucic","Nikola Moro","Toni Fruk"],ATT:["Ivan Perisic","Andrej Kramaric","Ante Budimir","Marco Pasalic","Petar Musa","Igor Matanovic"]},
  "Ghana 🇬🇭":{GK:["Joseph Anang","Benjamin Asare","Lawrence Ati-Zigi"],DEF:["Jonas Adjetey","Derrick Luckassen","Gideon Mensah","Abdul Mumin","Jerome Opoku","Kojo Oppong Preprah","Baba Abdul Rahman","Alidu Seidu","Marvin Senaya"],MID:["Augustine Boakye","Abdul Fatawu Issahaku","Elisha Owusu","Thomas Partey","Kwasi Sibo","Kamal Deen Sulemana","Caleb Yirenkyi"],ATT:["Prince Kwabena Adu","Jordan Ayew","Christopher Bonsu Baah","Ernest Nuamah","Antoine Semenyo","Brandon Thomas-Asante","Inaki Williams"]},
  "Panama 🇵🇦":{GK:["Orlando Mosquera","Luis Mejia","Cesar Samudio"],DEF:["Cesar Blackman","Jorge Gutierrez","Amir Murillo","Fidel Escobar","Andres Andrade","Edgardo Farina","Jose Cordoba","Eric Davis","Jiovany Ramos","Roderick Miller"],MID:["Anibal Godoy","Adalberto Carrasquilla","Carlos Harvey","Cristian Martinez","Jose Luis Rodriguez","Cesar Yanis","Yoel Barcenas","Alberto Quintero","Azarias Londono"],ATT:["Ismael Diaz","Cecilio Waterman","Jose Fajardo","Tomas Rodriguez"]},
};

// ─── UI Helpers ───────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  input,select{outline:none;} button:focus{outline:none;}
  input[type=number]{-moz-appearance:textfield;}
  input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
  select option{background:#12182b;}
  ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-thumb{background:#2a3050;border-radius:4px;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
  .fi{animation:fadeIn .3s ease both}
`;
const T = {bg:"#080c18",gold:"#e8c000",card:"rgba(255,255,255,.03)",border:"rgba(255,255,255,.07)",dim:"#4a5a7a",text:"#c0d0e8"};
const pill = (active,extra={}) => ({background:active?T.gold:"rgba(255,255,255,.05)",color:active?"#0a0d18":T.dim,border:`1px solid ${active?T.gold:"rgba(255,255,255,.08)"}`,borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600,fontSize:12,...extra});
const inp = (glow=false) => ({background:glow?"rgba(232,192,0,.08)":"rgba(255,255,255,.06)",border:`1px solid ${glow?"rgba(232,192,0,.3)":"rgba(255,255,255,.1)"}`,borderRadius:8,color:"#f0f0f0",fontFamily:"'DM Sans',sans-serif"});

function Pill({children,active,onClick}){ return <button onClick={onClick} style={pill(active)}>{children}</button>; }

function PinPad({value,onChange,label}){
  return <div>
    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:T.dim,marginBottom:10}}>{label}</div>
    <div style={{display:"flex",gap:10,marginBottom:16,justifyContent:"center"}}>{[0,1,2,3].map(i=><div key={i} style={{width:16,height:16,borderRadius:"50%",background:value.length>i?T.gold:"rgba(255,255,255,.15)"}}/>)}</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,maxWidth:200,margin:"0 auto"}}>
      {[1,2,3,4,5,6,7,8,9,null,0,"⌫"].map((d,i)=><button key={i} onClick={()=>{if(d===null)return;if(d==="⌫")onChange(value.slice(0,-1));else if(value.length<4)onChange(value+d);}} style={{background:d===null?"transparent":"rgba(255,255,255,.07)",border:d===null?"none":"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"14px 0",cursor:d===null?"default":"pointer",color:d==="⌫"?T.gold:"#f0f0f0",fontFamily:"'DM Sans',sans-serif",fontSize:d==="⌫"?18:20,fontWeight:600}}>{d}</button>)}
    </div>
  </div>;
}

function ScorerPicker({value,onChange,squad,placeholder,disabled}){
  const grouped=isGroupedSquad(squad);
  const groups=grouped?[{l:"🧤 Goalkeepers",p:squad.GK||[]},{l:"🛡️ Defenders",p:squad.DEF||[]},{l:"⚙️ Midfielders",p:squad.MID||[]},{l:"⚡ Attackers",p:squad.ATT||[]}].filter(g=>g.p.length>0):[];
  const flat=!grouped?(squad||[]):[];
  const has=grouped?groups.some(g=>g.p.length>0):flat.length>0;
  return <select value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled||!has} style={{background:disabled||!has?"rgba(255,255,255,.03)":"rgba(100,140,255,.08)",border:"1px solid rgba(100,140,255,.2)",borderRadius:8,padding:"6px 10px",color:value?"#c0d0e8":T.dim,fontSize:12,fontFamily:"'DM Sans',sans-serif",cursor:disabled||!has?"default":"pointer",width:"100%"}}>
    <option value="">{has?(placeholder||"— pick player —"):"No squad"}</option>
    {grouped?groups.map(g=><optgroup key={g.l} label={g.l}>{g.p.map(p=><option key={p} value={p}>{p}</option>)}</optgroup>):flat.map(p=><option key={p} value={p}>{p}</option>)}
  </select>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── Global state (shared across all leagues) ──────────────────────────────
  const [users,    setUsers]    = useState({});   // { name: { pin, isAdmin, superAdmin, leagues:[id,...] } }
  const [leagues,  setLeagues]  = useState({});   // { leagueId: { name, createdAt } }
  const [matches,  setMatches]  = useState(DEFAULT_MATCHES);
  // predictions: { leagueId: { username: { matchId: { homeScore, awayScore, homeScorers, awayScorers } } } }
  const [predictions, setPredictions] = useState({});

  // ── Session ────────────────────────────────────────────────────────────────
  const [session, setSession] = useState(() => localStorage.getItem("wcp_session") || null);
  const [activeLeague, setActiveLeague] = useState(() => localStorage.getItem("wcp_active_league") || null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [page,         setPage]         = useState("scoreboard");
  const [authMode,     setAuthMode]     = useState("login");
  const [authName,     setAuthName]     = useState("");
  const [authPin,      setAuthPin]      = useState("");
  const [authLeague,   setAuthLeague]   = useState("");
  const [authErr,      setAuthErr]      = useState("");
  const [phaseFilter,  setPhaseFilter]  = useState("All");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [toast,        setToast]        = useState(null);
  const [loaded,       setLoaded]       = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x+1), 30000); return () => clearInterval(t); }, []);

  // Admin forms
  const [newLeagueName, setNewLeagueName] = useState("");
  const [editPredUser,  setEditPredUser]  = useState("");
  const [editPredLeague,setEditPredLeague]= useState("");
  const [editPredPhase, setEditPredPhase] = useState("All");
  const [assignUser,    setAssignUser]    = useState("");
  const [assignLeague,  setAssignLeague]  = useState("");

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(null),2600); };

  // Persist session across page refreshes
  useEffect(() => {
    if (session) localStorage.setItem("wcp_session", session);
    else localStorage.removeItem("wcp_session");
  }, [session]);
  useEffect(() => {
    if (activeLeague) localStorage.setItem("wcp_active_league", activeLeague);
    else localStorage.removeItem("wcp_active_league");
  }, [activeLeague]);

  // ── Firebase listeners ────────────────────────────────────────────────────
  useEffect(()=>{
    const uns = [
      fbListen("users",       v=>{ if(v) setUsers(v); }),
      fbListen("leagues",     v=>{ setLeagues(v||{}); }),
      fbListen("matches_v2", v=>{
        if(v){
          const arr = Object.values(v);
          arr.sort((a,b)=>a.id-b.id);
          // Sync fixture details (teams, date, time, phase) from code while KEEPING entered results
          let needsUpdate = false;
          const merged = arr.map(m => {
            const def = DEFAULT_MATCHES.find(d=>d.id===m.id);
            if(!def) return m;
            const fixed = { ...m, home:def.home, away:def.away, date:def.date, phase:def.phase, kickoffTime:def.kickoffTime };
            // result is preserved from m (Firebase) — only fixture metadata is corrected
            if(m.home!==def.home || m.away!==def.away || m.date!==def.date || m.phase!==def.phase || m.kickoffTime!==def.kickoffTime){
              needsUpdate = true;
            }
            return fixed;
          });
          if(needsUpdate) fbSet("matches_v2", Object.fromEntries(merged.map(m=>[m.id,m])));
          setMatches(merged);
        } else {
          const seed = Object.fromEntries(DEFAULT_MATCHES.map(m=>[m.id,m]));
          fbSet("matches_v2", seed);
          setMatches(DEFAULT_MATCHES);
        }
      }),
      fbListen("predictions", v=>{ setPredictions(v||{}); }),
    ];
    setLoaded(true);
    return ()=>uns.forEach(u=>u());
  },[]);

  // Auto-set activeLeague when session changes
  useEffect(()=>{
    if(!session) { setActiveLeague(null); return; }
    const myLeagues = isSuperAdmin(session) ? Object.keys(leagues) : (users[session]?.leagues||[]);
    if(myLeagues.length>0 && !activeLeague) setActiveLeague(myLeagues[0]);
  },[session, leagues, users]);

  // ── API auto-sync removed — scores are entered manually in Admin ────────────

  // ── Derived ────────────────────────────────────────────────────────────────
  const isAdmin = session && (users[session]?.isAdmin || isSuperAdmin(session));
  const myLeagueIds = session
    ? (isSuperAdmin(session) ? Object.keys(leagues) : (users[session]?.leagues || []))
    : [];
  const phases = ["All",...new Set(matches.map(m=>m.phase))];
  const visibleMatches = phaseFilter==="All" ? matches : matches.filter(m=>m.phase===phaseFilter);

  // Members of active league = assigned players, PLUS admins (who show in every league).
  const leagueMembers = activeLeague
    ? Object.keys(users).filter(u => isSuperAdmin(u) || (users[u]?.leagues||[]).includes(activeLeague))
    : [];

  const MIRROR_FROM_MATCH = 49; // France vs Senegal onward

  // Mirror predictions for matches kicking off at or after France vs Senegal (Jun 16, 22:00 Riyadh).
  // Uses kickoff TIME (not match id) so it matches the chronological order shown in My Picks.
  const MIRROR_FROM_TIME = new Date("2026-06-16T22:00:00+03:00").getTime();
  const shouldMirror = (m) => {
    const match = matches.find(x=>x.id===m) || (typeof m==="object"?m:null);
    const kt = match?.kickoffTime;
    return kt ? new Date(kt).getTime() >= MIRROR_FROM_TIME : false;
  };

  // Get a player's prediction, falling back to their other leagues (France-Senegal onward by time).
  const getPred = (leagueId, uname, matchId) => {
    const here = predictions[leagueId]?.[uname]?.[matchId];
    const hasData = p => p && (p.homeScore!=null&&p.homeScore!=="" || p.awayScore!=null&&p.awayScore!=="" || (p.homeScorers||[]).some(Boolean) || (p.awayScorers||[]).some(Boolean));
    if(hasData(here)) return here;
    if(shouldMirror(matchId)){
      // Search EVERY league in the database for this player's pick (most reliable mirror)
      for(const lg of Object.keys(predictions||{})){
        if(lg===leagueId) continue;
        const other = predictions[lg]?.[uname]?.[matchId];
        if(hasData(other)) return other;
      }
    }
    return here;
  };

  // Leaderboard for active league
  const leaderboard = leagueMembers.map(u=>{
    let total=0,outcome=0,exact=0,scorerPts=0,played=0;
    matches.forEach(m=>{
      const pred = getPred(activeLeague, u, m.id);
      const pts = calcPoints(pred, m.result);
      if(pts!==null){
        played++; total+=pts;
        const res=m.result;
        if(res&&pred){
          const rh=parseInt(res.home),ra=parseInt(res.away),ph=parseInt(pred.homeScore),pa=parseInt(pred.awayScore);
          if(!isNaN(ph)&&!isNaN(pa)){
            if((ph>pa?"H":ph<pa?"A":"D")===(rh>ra?"H":rh<ra?"A":"D")) outcome++;
            if(ph===rh&&pa===ra) exact++;
          }
          const nrm=s=>s.toLowerCase().trim().replace(/\s+/g," ");
          const rs=(res.homeScorers||[]).concat(res.awayScorers||[]).map(nrm).filter(Boolean);
          const ps=(pred.homeScorers||[]).concat(pred.awayScorers||[]).map(nrm).filter(Boolean);
          const rem=[...rs];
          ps.forEach(p=>{ if(!p) return; const i=rem.indexOf(p); if(i!==-1){ scorerPts++; rem.splice(i,1); } });
        }
      }
    });
    return{name:u,total,outcome,exact,scorerPts,played};
  }).sort((a,b)=>b.total-a.total);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const handleAuth = async()=>{
    const name=authName.trim();
    if(!name) return setAuthErr("Enter a username");
    if(authPin.length!==4) return setAuthErr("PIN must be 4 digits");
    if(authMode==="register"){
      const existing=await fbGet("users");
      if(existing?.[name]) return setAuthErr("Username taken");
      if(!isSuperAdmin(name) && Object.keys(leagues).length>0 && !authLeague) return setAuthErr("Please select a league");
      const isAdm=!existing||Object.keys(existing).length===0||isSuperAdmin(name);
      const selectedLeagues = authLeague ? [authLeague] : [];
      await fbSet(`users/${name}`,{pin:authPin,isAdmin:isAdm,superAdmin:isSuperAdmin(name),leagues:selectedLeagues});
      setSession(name); setPage("scoreboard"); setActiveLeague(authLeague||null);
      setAuthErr(""); setAuthName(""); setAuthPin(""); setAuthLeague("");
    } else {
      const u=await fbGet(`users/${name}`);
      if(!u) return setAuthErr("User not found");
      if(u.pin!==authPin) return setAuthErr("Wrong PIN");
      setSession(name); setPage("scoreboard");
      setAuthErr(""); setAuthName(""); setAuthPin("");
    }
  };

  // ── Predictions ────────────────────────────────────────────────────────────
  // Matches with id >= MIRROR_FROM_MATCH are auto-mirrored across all of a
  // multi-league player's leagues, so they only need to guess once.
  const setPred=(matchId,field,val)=>{
    if(!activeLeague||!session) return;
    // Which leagues to write to: if match is in the mirror range, write to ALL the player's leagues
    const myLeagues = isSuperAdmin(session) ? Object.keys(leagues) : (users[session]?.leagues || [activeLeague]);
    const targetLeagues = (shouldMirror(matchId) && myLeagues.length > 1) ? myLeagues : [activeLeague];
    setPredictions(prev=>{
      const next = {...prev};
      targetLeagues.forEach(lg=>{
        fbSet(`predictions/${lg}/${session}/${matchId}/${field}`,val);
        next[lg] = {...next[lg], [session]:{...next[lg]?.[session], [matchId]:{...next[lg]?.[session]?.[matchId], [field]:val}}};
      });
      return next;
    });
  };

  // Admin: edit ANY player's prediction in ANY league (bypasses lock)
  const setPredFor=(leagueId,uname,matchId,field,val)=>{
    if(!leagueId||!uname) return;
    // Mirror admin edits across all the player's leagues for matches in the mirror range
    const userLeagues = isSuperAdmin(uname) ? Object.keys(leagues) : (users[uname]?.leagues || [leagueId]);
    const targetLeagues = (shouldMirror(matchId) && userLeagues.length > 1) ? userLeagues : [leagueId];
    setPredictions(prev=>{
      const next = {...prev};
      targetLeagues.forEach(lg=>{
        fbSet(`predictions/${lg}/${uname}/${matchId}/${field}`,val);
        next[lg] = {...next[lg], [uname]:{...next[lg]?.[uname], [matchId]:{...next[lg]?.[uname]?.[matchId], [field]:val}}};
      });
      return next;
    });
  };

  // ── Match admin ────────────────────────────────────────────────────────────
  const setMatchResult=(id,field,val)=>{
    fbSet(`matches_v2/${id}/result/${field}`,val);
    setMatches(prev=>prev.map(m=>m.id===id?{...m,result:{...m.result,[field]:val}}:m));
  };
  const setMatchKickoff=(id,val)=>{
    // Always store with Riyadh offset so the deadline is the same moment worldwide
    const withTz = val && !val.includes("+") && !val.endsWith("Z") ? `${val}+03:00` : val;
    fbSet(`matches_v2/${id}/kickoffTime`,withTz);
    setMatches(prev=>prev.map(m=>m.id===id?{...m,kickoffTime:withTz}:m));
  };

  // ── League admin ───────────────────────────────────────────────────────────
  const createLeague=async()=>{
    const name=newLeagueName.trim();
    if(!name) return;
    const id="league_"+Date.now();
    await fbSet(`leagues/${id}`,{name,createdAt:Date.now()});
    setNewLeagueName("");
    showToast(`League "${name}" created!`);
  };
  const assignToLeague=async()=>{
    if(!assignUser||!assignLeague) return;
    const current=users[assignUser]?.leagues||[];
    if(current.includes(assignLeague)){ showToast("Already in this league"); return; }
    await fbSet(`users/${assignUser}/leagues`,[...current,assignLeague]);
    showToast(`${assignUser} added to ${leagues[assignLeague]?.name}`);
    setAssignUser(""); setAssignLeague("");
  };
  const removeFromLeague=async(uname,lid)=>{
    const current=users[uname]?.leagues||[];
    await fbSet(`users/${uname}/leagues`,current.filter(l=>l!==lid));
    showToast(`${uname} removed from ${leagues[lid]?.name}`);
  };
  const deleteLeague=async(lid)=>{
    await fbSet(`leagues/${lid}`,null);
    await fbSet(`predictions/${lid}`,null);
    // remove league from all users
    Object.keys(users).forEach(u=>{
      const ls=(users[u]?.leagues||[]).filter(l=>l!==lid);
      fbSet(`users/${u}/leagues`,ls);
    });
    showToast("League deleted");
    if(activeLeague===lid) setActiveLeague(null);
  };

  // One-time: copy each multi-league player's existing picks (match id >= MIRROR_FROM_MATCH)
  // into every league they belong to, so all their leagues match. Picks a "source" per match
  // = whichever league already has a guess for it.
  const syncMultiLeaguePicks=async()=>{
    showToast("Syncing…");
    // Read the freshest predictions straight from Firebase (not stale state)
    const allPreds = (await fbGet("predictions")) || {};
    const allLeagueIds = Object.keys(leagues);
    let copied=0, playersAffected=0;
    const debug=[];

    // Build the list of (user -> leagues to mirror across)
    const targets = {};
    Object.keys(users).forEach(u=>{
      if(isSuperAdmin(u)){
        targets[u] = allLeagueIds;
      } else {
        const ls = users[u]?.leagues || [];
        if(ls.length > 1) targets[u] = ls;
      }
    });

    for(const u of Object.keys(targets)){
      const myLeagues = targets[u];
      if(myLeagues.length < 2) continue;
      let touched=false, found=0;
      for(const m of matches){
        if(!shouldMirror(m.id)) continue;
        // find the most complete pick across this player's leagues for this match
        let source=null;
        for(const lg of myLeagues){
          const p = allPreds[lg]?.[u]?.[m.id];
          const hasData = p && (p.homeScore!=null&&p.homeScore!=="" || p.awayScore!=null&&p.awayScore!=="" || (p.homeScorers||[]).some(Boolean) || (p.awayScorers||[]).some(Boolean));
          if(hasData){ source=p; break; }
        }
        if(!source) continue;
        found++;
        // write that pick into every league the player belongs to
        for(const lg of myLeagues){
          await fbSet(`predictions/${lg}/${u}/${m.id}`, source);
          copied++;
        }
        touched=true;
      }
      debug.push(`${u}[${myLeagues.length}lg]:${found}`);
      if(touched) playersAffected++;
    }
    console.log("SYNC DEBUG:", debug.join(", "), "| leagues:", allLeagueIds);
    showToast(`Synced ${playersAffected} players · ${copied} picks · ${debug.join(", ")}`);
  };

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const tabs=[
    {key:"scoreboard",label:"🏆 Scoreboard"},
    ...(session?[{key:"predict",label:"📝 My Picks"}]:[]),
    {key:"matches",   label:"📅 Matches"},
    {key:"players",   label:"👥 Players"},
    ...(isAdmin?[{key:"admin",label:"⚙️ Admin"}]:[]),
    ...(!session?[{key:"auth",label:"👤 Sign in"}]:[]),
  ];

  // ── League switcher (shown when user has multiple leagues) ─────────────────
  const LeagueSwitcher = ()=>{
    if(myLeagueIds.length<=1) return null;
    return <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"0 0 18px",background:"rgba(255,255,255,.02)",padding:"10px 12px",borderRadius:10}}>
      <span style={{fontSize:11,color:T.dim,fontWeight:600,alignSelf:"center",marginRight:4}}>LEAGUE:</span>
      {myLeagueIds.map(lid=><button key={lid} onClick={()=>setActiveLeague(lid)} style={pill(activeLeague===lid,{fontSize:13,padding:"6px 16px"})}>{leagues[lid]?.name||lid}</button>)}
    </div>;
  };

  // ── No league state ────────────────────────────────────────────────────────
  const NoLeague = ()=><div style={{textAlign:"center",padding:"60px 20px",color:T.dim}}>
    <div style={{fontSize:40,marginBottom:12}}>🏟️</div>
    <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:22,letterSpacing:2,color:"#3a4a6a",marginBottom:8}}>NO LEAGUE YET</div>
    <div style={{fontSize:13}}>You haven't been assigned to a league.<br/>Ask Faisal to add you.</div>
  </div>;

  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:T.bg,color:"#f0f0f0",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{css}</style>

      {/* Toast */}
      {toast&&<div style={{position:"fixed",bottom:28,left:"50%",transform:"translateX(-50%)",background:T.gold,color:T.bg,borderRadius:30,padding:"10px 24px",fontWeight:700,fontSize:14,zIndex:999,animation:"toastIn .3s ease",whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(232,192,0,.4)"}}>{toast}</div>}

      {/* HEADER */}
      <div style={{position:"relative",overflow:"hidden",background:"linear-gradient(160deg,#0f1428,#0a0e1c)",borderBottom:"1px solid rgba(232,192,0,.15)"}}>
        <div style={{position:"absolute",top:-60,right:-60,width:240,height:240,borderRadius:"50%",background:"radial-gradient(circle,rgba(232,192,0,.07),transparent 70%)"}}/>
        <div style={{position:"relative",padding:"20px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:32,letterSpacing:4,color:T.gold,lineHeight:1}}>⚽ WC PREDICTOR 2026</div>
            <div style={{fontSize:11,color:T.dim,marginTop:4,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              {Object.keys(users).length} players · {Object.keys(leagues).length} leagues
              <span style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"#44cc88",display:"inline-block",animation:"pulse 2s ease-in-out infinite"}}/>
                <span style={{color:"#2a4a2a",fontSize:10}}>LIVE SYNC</span>
              </span>
              {activeLeague&&leagues[activeLeague]&&<span style={{background:"rgba(232,192,0,.1)",color:T.gold,borderRadius:10,padding:"2px 10px",fontSize:11,fontWeight:700}}>📋 {leagues[activeLeague].name}</span>}
            </div>
          </div>
          {session?(
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
              <div style={{fontSize:12,color:"#7a8aaa"}}>
                👤 <span style={{color:T.gold,fontWeight:700}}>{session}</span>
                {isAdmin&&<span style={{background:isSuperAdmin(session)?"rgba(255,100,0,.2)":"rgba(232,192,0,.15)",color:isSuperAdmin(session)?"#ff8c00":T.gold,borderRadius:10,padding:"2px 8px",fontSize:10,marginLeft:6,fontWeight:700}}>{isSuperAdmin(session)?"⚡ SUPER ADMIN":"ADMIN"}</span>}
              </div>
              <button onClick={()=>{setSession(null);setPage("scoreboard");setActiveLeague(null);localStorage.removeItem("wcp_session");localStorage.removeItem("wcp_active_league");}} style={{background:"rgba(255,80,80,.1)",border:"1px solid rgba(255,80,80,.2)",color:"#ff6666",borderRadius:8,padding:"4px 12px",cursor:"pointer",fontSize:12,fontWeight:600}}>Sign out</button>
            </div>
          ):(
            <button onClick={()=>{setPage("auth");setAuthMode("login");}} style={{background:T.gold,color:T.bg,border:"none",borderRadius:10,padding:"8px 18px",cursor:"pointer",fontWeight:700,fontSize:13}}>Sign in</button>
          )}
        </div>
        <div style={{display:"flex",paddingLeft:4,overflowX:"auto"}}>
          {tabs.map(t=><button key={t.key} onClick={()=>{setPage(t.key);if(t.key!=="players")setSelectedPlayer(null);}} style={{background:"none",border:"none",borderBottom:page===t.key?"2px solid "+T.gold:"2px solid transparent",color:page===t.key?T.gold:T.dim,padding:"10px 16px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13,whiteSpace:"nowrap"}}>{t.label}</button>)}
        </div>
      </div>

      <div style={{padding:"22px 16px",maxWidth:760,margin:"0 auto"}}>

        {/* ── SCOREBOARD ─────────────────────────────────────────────────────── */}
        {page==="scoreboard"&&<div className="fi">
          <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:T.gold,marginBottom:6}}>LEADERBOARD</div>
          <div style={{fontSize:12,color:T.dim,marginBottom:16,background:T.card,borderRadius:10,padding:"10px 14px",lineHeight:1.9}}>
            <span style={{color:T.gold,fontWeight:700}}>+1</span> correct outcome &nbsp;·&nbsp;
            <span style={{color:"#44cc88",fontWeight:700}}>+3</span> exact score &nbsp;·&nbsp;
            <span style={{color:"#6699ff",fontWeight:700}}>+1</span> per scorer guessed
          </div>
          <LeagueSwitcher/>
          {!session ? <div style={{textAlign:"center",color:T.dim,padding:"50px 20px"}}><div style={{fontSize:36,marginBottom:10}}>🔒</div><div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:20,letterSpacing:2,color:"#3a4a6a",marginBottom:6}}>SIGN IN TO VIEW</div><div style={{fontSize:13}}>Sign in to see your league's scoreboard.</div></div>
            : !activeLeague ? <NoLeague/> : leaderboard.length===0
            ? <div style={{textAlign:"center",color:T.dim,padding:"40px 0",fontStyle:"italic"}}>No players in this league yet.</div>
            : leaderboard.map((p,i)=>{
                const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
                return <div key={p.name} style={{background:i===0?"linear-gradient(135deg,rgba(232,192,0,.1),rgba(232,192,0,.03))":T.card,border:`1px solid ${i===0?"rgba(232,192,0,.25)":T.border}`,borderRadius:12,padding:"14px 18px",marginBottom:8,display:"flex",alignItems:"center",gap:14,animation:`fadeIn .3s ${i*.06}s ease both`}}>
                  <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,width:36,color:i===0?T.gold:i===1?"#aaa":i===2?"#cd7f32":"#3a4a6a",textAlign:"center"}}>{medal||`${i+1}`}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:15,color:i===0?"#f0e080":T.text}}>{p.name}</div>
                    <div style={{fontSize:11,color:T.dim,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                      <span><span style={{color:T.gold}}>{p.outcome}</span> outcome</span>
                      <span><span style={{color:"#44cc88"}}>{p.exact}</span> exact</span>
                      <span><span style={{color:"#6699ff"}}>{p.scorerPts}</span> scorer</span>
                      <span style={{color:"#3a4a6a"}}>{p.played} played</span>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:38,color:i===0?T.gold:"#5a6a8a",lineHeight:1}}>{p.total}</div>
                    <div style={{fontSize:10,color:"#3a4a6a",letterSpacing:1}}>PTS</div>
                  </div>
                </div>;
              })
          }
        </div>}

        {/* ── MATCHES ────────────────────────────────────────────────────────── */}
        {page==="matches"&&<div className="fi">
          <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:T.gold,marginBottom:16}}>ALL MATCHES</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>{phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}</div>
          {visibleMatches.map(m=>{
            const hasRes=m.result?.home!=null&&m.result?.home!=="";
            const all=[...(m.result?.homeScorers||[]),...(m.result?.awayScorers||[])].filter(Boolean);
            return <div key={m.id} style={{background:"rgba(255,255,255,.025)",border:`1px solid ${hasRes?"rgba(68,204,136,.15)":T.border}`,borderRadius:10,padding:"12px 14px",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{minWidth:72}}>
                  <div style={{fontSize:9,color:T.gold,fontWeight:700}}>{m.phase}</div>
                  <div style={{fontSize:11,color:"#3a4a6a",fontWeight:600}}>{m.date}</div>
                  {m.kickoffTime&&!hasRes&&<div style={{fontSize:9,color:isPredLocked(m)?"#ff6666":timeUntilDeadline(m)?"#44cc88":T.dim}}>{isPredLocked(m)?"🔒":timeUntilDeadline(m)?`⏳ ${timeUntilDeadline(m)}`:"open"}</div>}
                </div>
                <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:22,color:hasRes?T.gold:"#2a3a5a",minWidth:64,textAlign:"center"}}>{hasRes?`${m.result.home} – ${m.result.away}`:"vs"}</div>
                <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
              </div>
              {hasRes&&all.length>0&&<div style={{marginTop:6,fontSize:11,color:"#6699ff"}}>⚽ {all.join(", ")}</div>}
            </div>;
          })}
        </div>}

        {/* ── PLAYERS ────────────────────────────────────────────────────────── */}
        {page==="players"&&<div className="fi">
          <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:T.gold,marginBottom:6}}>PLAYERS</div>
          <LeagueSwitcher/>
          {!session ? <div style={{textAlign:"center",color:T.dim,padding:"50px 20px"}}><div style={{fontSize:36,marginBottom:10}}>🔒</div><div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:20,letterSpacing:2,color:"#3a4a6a",marginBottom:6}}>SIGN IN TO VIEW</div><div style={{fontSize:13}}>Sign in to see your league's players.</div></div>
          : !activeLeague ? <NoLeague/> : <>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
              {leagueMembers.map(u=><button key={u} onClick={()=>setSelectedPlayer(selectedPlayer===u?null:u)} style={pill(selectedPlayer===u,{fontSize:13,padding:"7px 18px"})}>
                {u} <span style={{marginLeft:6,color:selectedPlayer===u?T.bg:T.gold,fontWeight:700}}>{leaderboard.find(l=>l.name===u)?.total||0}pts</span>
              </button>)}
            </div>
            {selectedPlayer&&(()=>{
              const lb=leaderboard.find(l=>l.name===selectedPlayer)||{};
              return <div>
                <div style={{background:"linear-gradient(135deg,rgba(232,192,0,.1),rgba(232,192,0,.03))",border:"1px solid rgba(232,192,0,.2)",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
                  <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:42,color:T.gold,lineHeight:1}}>{lb.total||0}<span style={{fontSize:16,color:T.dim,marginLeft:4}}>pts</span></div>
                  <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                    {[[T.gold,lb.outcome||0,"OUTCOME"],["#44cc88",lb.exact||0,"EXACT"],["#6699ff",lb.scorerPts||0,"SCORER"],["#7a8aaa",lb.played||0,"PLAYED"]].map(([c,v,l])=><div key={l} style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:24,color:c}}>{v}</div><div style={{fontSize:10,color:T.dim}}>{l}</div></div>)}
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>{phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}</div>
                {visibleMatches.map(m=>{
                  const pred=getPred(activeLeague, selectedPlayer, m.id);
                  const res=m.result,hasRes=res?.home!=null&&res?.home!=="";
                  const pts=calcPoints(pred,res);
                  const pc=pts===null?"#2a3a5a":pts===0?"#ff4466":pts<=2?"#ffaa00":pts<=4?"#44cc88":T.gold;
                  const allR=[...(res?.homeScorers||[]),...(res?.awayScorers||[])].filter(Boolean);
                  const allP=[...(pred?.homeScorers||[]),...(pred?.awayScorers||[])].filter(Boolean);
                  return <div key={m.id} style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.04)",borderRadius:10,padding:"11px 14px",marginBottom:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{minWidth:68}}><div style={{fontSize:9,color:T.gold,fontWeight:700}}>{m.phase}</div><div style={{fontSize:11,color:"#3a4a6a"}}>{m.date}</div></div>
                      <div style={{flex:1,fontWeight:600,fontSize:12}}>{m.home}</div>
                      <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:17,color:T.gold,minWidth:46,textAlign:"center"}}>{pred?.homeScore!=null&&pred?.awayScore!=null?`${pred.homeScore}–${pred.awayScore}`:<span style={{color:"#2a3a5a",fontSize:11}}>—</span>}</div>
                      <span style={{color:"#3a4a6a",fontSize:10}}>→</span>
                      <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:17,color:hasRes?"#44cc88":"#2a3a5a",minWidth:46,textAlign:"center"}}>{hasRes?`${res.home}–${res.away}`:"TBD"}</div>
                      <div style={{flex:1,fontWeight:600,fontSize:12,textAlign:"right"}}>{m.away}</div>
                      <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:24,color:pc,minWidth:34,textAlign:"right"}}>{pts!==null?`+${pts}`:"—"}</div>
                    </div>
                    {(allP.length>0||allR.length>0)&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid rgba(255,255,255,.05)",fontSize:11,display:"flex",gap:12,flexWrap:"wrap"}}>
                      {allP.length>0&&<span style={{color:T.dim}}>Guessed: <span style={{color:"#a0b8e8"}}>{allP.join(", ")}</span></span>}
                      {allR.length>0&&<span style={{color:T.dim}}>Scored: <span style={{color:"#6699ff"}}>{allR.join(", ")}</span></span>}
                    </div>}
                  </div>;
                })}
              </div>;
            })()}
          </>}
        </div>}

        {/* ── MY PICKS ───────────────────────────────────────────────────────── */}
        {page==="predict"&&session&&<div className="fi">
          <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:T.gold,marginBottom:6}}>MY PREDICTIONS</div>
          <LeagueSwitcher/>
          {!activeLeague ? <NoLeague/> : <>
            <div style={{fontSize:12,color:T.dim,marginBottom:16}}>Sorted by kickoff time · Locks 1.5h before · +1 outcome · +3 exact · +1 per scorer</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>{phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}</div>
            {[...visibleMatches].sort((a,b)=>{
              if(a.kickoffTime&&b.kickoffTime) return new Date(a.kickoffTime)-new Date(b.kickoffTime);
              if(a.kickoffTime) return -1;
              if(b.kickoffTime) return 1;
              return a.id-b.id;
            }).map(m=>{
              const pred=getPred(activeLeague, session, m.id)||{};
              const pts=calcPoints(pred,m.result);
              const hasRes=m.result?.home!=null&&m.result?.home!=="";
              const locked=hasRes||isPredLocked(m);
              const deadline=timeUntilDeadline(m);
              const ph=parseInt(pred.homeScore)||0,pa=parseInt(pred.awayScore)||0;
              const hS=Math.min(ph,8),aS=Math.min(pa,8);
              const hSq=DEFAULT_SQUADS[m.home]||{},aSq=DEFAULT_SQUADS[m.away]||{};
              return <div key={m.id} style={{background:T.card,border:`1px solid ${locked&&!hasRes?"rgba(255,100,0,.2)":T.border}`,borderRadius:12,padding:"14px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div>
                    <span style={{fontSize:10,color:T.gold,fontWeight:700,letterSpacing:1}}>{m.phase}</span>
                    <div style={{fontSize:11,color:T.dim}}>{m.kickoffTime?new Date(m.kickoffTime).toLocaleString([],{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" your time":m.date}{m.kickoffTime&&!hasRes&&<span style={{marginLeft:8,color:locked?"#ff6666":deadline?"#44cc88":"#7a8aaa"}}>{locked?"🔒 closed":deadline?`⏳ ${deadline} to predict`:"✅ open"}</span>}</div>
                  </div>
                  {pts!==null&&<div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:28,color:pts===0?"#ff4466":pts<=2?"#ffaa00":pts<=4?"#44cc88":T.gold}}>{pts>0?`+${pts}`:"0"} <span style={{fontSize:13,color:T.dim}}>pts</span></div>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                  <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                  <input type="number" min="0" max="20" value={pred.homeScore??""} onChange={e=>{setPred(m.id,"homeScore",e.target.value);setPred(m.id,"homeScorers",[]);}} disabled={locked} style={{width:44,textAlign:"center",...inp(!locked),padding:"7px 2px",color:T.gold,fontSize:18,fontWeight:700}}/>
                  <span style={{color:"#3a4a6a",fontWeight:700}}>–</span>
                  <input type="number" min="0" max="20" value={pred.awayScore??""} onChange={e=>{setPred(m.id,"awayScore",e.target.value);setPred(m.id,"awayScorers",[]);}} disabled={locked} style={{width:44,textAlign:"center",...inp(!locked),padding:"7px 2px",color:T.gold,fontSize:18,fontWeight:700}}/>
                  <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
                </div>
                {(hS>0||aS>0)&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div>
                    <div style={{fontSize:10,color:T.dim,fontWeight:700,marginBottom:5}}>⚽ {m.home} ({hS})</div>
                    {Array.from({length:hS}).map((_,si)=><div key={si} style={{marginBottom:4}}><ScorerPicker value={(pred.homeScorers||[])[si]||""} onChange={v=>{const a=[...(pred.homeScorers||[])];a[si]=v;setPred(m.id,"homeScorers",a);}} squad={hSq} placeholder={`Goal ${si+1}`} disabled={locked}/></div>)}
                  </div>
                  <div>
                    <div style={{fontSize:10,color:T.dim,fontWeight:700,marginBottom:5}}>⚽ {m.away} ({aS})</div>
                    {Array.from({length:aS}).map((_,si)=><div key={si} style={{marginBottom:4}}><ScorerPicker value={(pred.awayScorers||[])[si]||""} onChange={v=>{const a=[...(pred.awayScorers||[])];a[si]=v;setPred(m.id,"awayScorers",a);}} squad={aSq} placeholder={`Goal ${si+1}`} disabled={locked}/></div>)}
                  </div>
                </div>}
                {hasRes&&<div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.05)",fontSize:12,color:T.dim}}>
                  Result: <span style={{color:"#44cc88",fontWeight:700}}>{m.result.home}–{m.result.away}</span>
                  {[...(m.result.homeScorers||[]),...(m.result.awayScorers||[])].filter(Boolean).length>0&&<span style={{color:"#6699ff",marginLeft:10}}>⚽ {[...(m.result.homeScorers||[]),...(m.result.awayScorers||[])].filter(Boolean).join(", ")}</span>}
                </div>}
              </div>;
            })}
          </>}
        </div>}

        {/* ── AUTH ───────────────────────────────────────────────────────────── */}
        {page==="auth"&&!session&&<div className="fi" style={{maxWidth:320,margin:"0 auto",paddingTop:20}}>
          <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:28,letterSpacing:3,color:T.gold,marginBottom:20}}>{authMode==="login"?"SIGN IN":"CREATE ACCOUNT"}</div>
          <div style={{display:"flex",marginBottom:24,background:"rgba(255,255,255,.04)",borderRadius:10,padding:3}}>
            {["login","register"].map(m=><button key={m} onClick={()=>{setAuthMode(m);setAuthErr("");setAuthPin("");setAuthLeague("");}} style={{flex:1,background:authMode===m?T.gold:"transparent",color:authMode===m?T.bg:T.dim,border:"none",borderRadius:8,padding:"8px 0",cursor:"pointer",fontWeight:700,fontSize:13}}>{m==="login"?"Sign In":"Register"}</button>)}
          </div>
          <div style={{marginBottom:20}}>
            <label style={{fontSize:12,color:"#7a8aaa",display:"block",marginBottom:6,fontWeight:600}}>USERNAME</label>
            <input value={authName} onChange={e=>setAuthName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="Your name…" style={{width:"100%",...inp(),padding:"11px 14px",fontSize:15}}/>
          </div>
          {authMode==="register"&&Object.keys(leagues).length>0&&(
            <div style={{marginBottom:20}}>
              <label style={{fontSize:12,color:"#7a8aaa",display:"block",marginBottom:6,fontWeight:600}}>SELECT LEAGUE</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {Object.entries(leagues).map(([lid,lg])=>(
                  <button key={lid} onClick={()=>setAuthLeague(authLeague===lid?"":lid)} style={{...pill(authLeague===lid,{fontSize:14,padding:"9px 20px",borderRadius:10,flex:1})}}>
                    📋 {lg.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <PinPad value={authPin} onChange={setAuthPin} label="4-DIGIT PIN"/>
          {authErr&&<div style={{color:"#ff6666",fontSize:13,marginTop:14,textAlign:"center",fontWeight:600}}>{authErr}</div>}
          <button onClick={handleAuth} style={{width:"100%",marginTop:20,background:authPin.length===4?T.gold:"rgba(255,255,255,.06)",color:authPin.length===4?T.bg:T.dim,border:"none",borderRadius:12,padding:"14px 0",cursor:authPin.length===4?"pointer":"default",fontWeight:700,fontSize:16,fontFamily:"'DM Sans',sans-serif"}}>{authMode==="login"?"Sign In →":"Create Account →"}</button>
        </div>}

        {/* ── ADMIN ──────────────────────────────────────────────────────────── */}
        {page==="admin"&&isAdmin&&<div className="fi">
          <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:26,letterSpacing:3,color:T.gold,marginBottom:20,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            ADMIN PANEL
          </div>

          {/* ── League management ── */}
          <Section title="🔍 PREDICTION DEBUG">
            <div style={{fontSize:11,color:T.dim,marginBottom:10}}>Shows where each player's predictions are stored. Temporary — for troubleshooting.</div>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:8,padding:"12px",fontSize:11,fontFamily:"monospace",color:"#9fb8e8",maxHeight:300,overflow:"auto"}}>
              <div style={{color:"#e8c000",marginBottom:6}}>Leagues: {Object.entries(leagues).map(([id,l])=>`${l.name}=${id.slice(-6)}`).join(", ")||"none"}</div>
              {Object.keys(predictions||{}).map(lgId=>{
                const lgName = leagues[lgId]?.name || lgId.slice(-6);
                const players = Object.keys(predictions[lgId]||{});
                return <div key={lgId} style={{marginBottom:8}}>
                  <div style={{color:"#44cc88"}}>📋 {lgName} ({players.length} players)</div>
                  {players.map(pl=>{
                    const picks = Object.keys(predictions[lgId][pl]||{});
                    const withData = picks.filter(mid=>{const p=predictions[lgId][pl][mid];return p&&(p.homeScore!=null&&p.homeScore!=="");});
                    return <div key={pl} style={{paddingLeft:12,color:"#c0d0e8"}}>{pl}: {withData.length} picks [ids: {withData.slice(0,8).join(",")}{withData.length>8?"…":""}]</div>;
                  })}
                </div>;
              })}
              {Object.keys(predictions||{}).length===0&&<div style={{color:"#ff6666"}}>No predictions data loaded!</div>}
            </div>
          </Section>

          <Section title="MANAGE LEAGUES">
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              <input value={newLeagueName} onChange={e=>setNewLeagueName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createLeague()} placeholder="New league name…" style={{flex:1,...inp(),padding:"9px 12px",fontSize:13,minWidth:140}}/>
              <button onClick={createLeague} style={{background:T.gold,color:T.bg,border:"none",borderRadius:8,padding:"9px 18px",cursor:"pointer",fontWeight:700,fontSize:13}}>+ Create</button>
            </div>
            {Object.keys(leagues).length===0
              ? <div style={{color:T.dim,fontSize:13,fontStyle:"italic"}}>No leagues yet. Create one above.</div>
              : Object.entries(leagues).map(([lid,lg])=><div key={lid} style={{background:"rgba(232,192,0,.05)",border:"1px solid rgba(232,192,0,.15)",borderRadius:10,padding:"12px 16px",marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:15,color:T.gold}}>📋 {lg.name}</div>
                    <button onClick={()=>deleteLeague(lid)} style={{background:"rgba(255,80,80,.1)",border:"1px solid rgba(255,80,80,.2)",color:"#ff6666",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:12,fontWeight:600}}>Delete</button>
                  </div>
                  <div style={{fontSize:12,color:T.dim,marginBottom:6}}>
                    Members: {Object.keys(users).filter(u=>(users[u]?.leagues||[]).includes(lid)||isSuperAdmin(u)).map(u=><span key={u} style={{display:"inline-flex",alignItems:"center",gap:4,background:"rgba(255,255,255,.06)",borderRadius:12,padding:"2px 8px",margin:"2px",fontSize:11}}>
                      {u}
                      {!isSuperAdmin(u)&&<button onClick={()=>removeFromLeague(u,lid)} style={{background:"none",border:"none",color:"#ff4466",cursor:"pointer",fontSize:12,padding:0,lineHeight:1}}>×</button>}
                    </span>)}
                  </div>
                </div>)
            }
          </Section>

          {/* ── Assign player to league ── */}
          <Section title="ASSIGN PLAYER TO LEAGUE">
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
              <select value={assignUser} onChange={e=>setAssignUser(e.target.value)} style={{flex:1,...inp(),padding:"9px 12px",fontSize:13,cursor:"pointer"}}>
                <option value="">Select player…</option>
                {Object.keys(users).filter(u=>!isSuperAdmin(u)).map(u=><option key={u} value={u}>{u}</option>)}
              </select>
              <select value={assignLeague} onChange={e=>setAssignLeague(e.target.value)} style={{flex:1,...inp(),padding:"9px 12px",fontSize:13,cursor:"pointer"}}>
                <option value="">Select league…</option>
                {Object.entries(leagues).map(([lid,lg])=><option key={lid} value={lid}>{lg.name}</option>)}
              </select>
              <button onClick={assignToLeague} style={{background:T.gold,color:T.bg,border:"none",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>Assign</button>
            </div>
            <div style={{fontSize:11,color:T.dim}}>A player can be assigned to multiple leagues. Faisal (super admin) sees all leagues automatically.</div>
            <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{fontSize:11,color:T.dim,marginBottom:8}}>Multi-league players only need to guess once. This copies their existing picks (from France–Senegal onward) across all their leagues, and future picks auto-mirror.</div>
              <button onClick={syncMultiLeaguePicks} style={{background:"rgba(100,140,255,.12)",border:"1px solid rgba(100,140,255,.3)",color:"#7aa0ff",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13}}>🔄 Sync Multi-League Picks</button>
            </div>
          </Section>

          {/* ── Enter results ── */}
          <Section title="ENTER MATCH RESULTS">
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{phases.map(ph=><Pill key={ph} active={phaseFilter===ph} onClick={()=>setPhaseFilter(ph)}>{ph}</Pill>)}</div>
            {visibleMatches.map(m=>{
              const res=m.result||{};
              const rh=parseInt(res.home)||0,ra=parseInt(res.away)||0;
              const hS=Math.min(rh,8),aS=Math.min(ra,8);
              const hSq=DEFAULT_SQUADS[m.home]||{},aSq=DEFAULT_SQUADS[m.away]||{};
              return <div key={m.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"13px 14px",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{fontSize:10,color:T.gold,fontWeight:700,minWidth:80}}>{m.phase}<br/><span style={{color:T.dim}}>{m.date}</span></div>
                  <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                  <input type="number" min="0" max="20" value={res.home??""} onChange={e=>setMatchResult(m.id,"home",e.target.value)} style={{width:44,textAlign:"center",background:"rgba(68,204,136,.08)",border:"1px solid rgba(68,204,136,.25)",borderRadius:8,padding:"7px 2px",color:"#44cc88",fontSize:18,fontWeight:700}}/>
                  <span style={{color:"#3a4a6a"}}>–</span>
                  <input type="number" min="0" max="20" value={res.away??""} onChange={e=>setMatchResult(m.id,"away",e.target.value)} style={{width:44,textAlign:"center",background:"rgba(68,204,136,.08)",border:"1px solid rgba(68,204,136,.25)",borderRadius:8,padding:"7px 2px",color:"#44cc88",fontSize:18,fontWeight:700}}/>
                  <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                  <label style={{fontSize:10,color:T.dim,fontWeight:600,whiteSpace:"nowrap"}}>⏰ KICKOFF:</label>
                  <input type="datetime-local" value={m.kickoffTime?.slice(0,16)||""} onChange={e=>setMatchKickoff(m.id,e.target.value)} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",color:"#c0d0e8",fontSize:11,fontFamily:"'DM Sans',sans-serif"}}/>
                  {m.kickoffTime&&<span style={{fontSize:10,color:isPredLocked(m)?"#ff6666":"#44cc88"}}>{isPredLocked(m)?"🔒":"✅"}</span>}
                </div>
                {(hS>0||aS>0)&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div>
                    <div style={{fontSize:10,color:"#44cc88",fontWeight:700,marginBottom:4}}>⚽ {m.home} ({hS})</div>
                    {Array.from({length:hS}).map((_,si)=><div key={si} style={{marginBottom:4}}><ScorerPicker value={(res.homeScorers||[])[si]||""} onChange={v=>{const a=[...(res.homeScorers||[])];a[si]=v;setMatchResult(m.id,"homeScorers",a);}} squad={hSq} placeholder={`Goal ${si+1}`}/></div>)}
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"#44cc88",fontWeight:700,marginBottom:4}}>⚽ {m.away} ({aS})</div>
                    {Array.from({length:aS}).map((_,si)=><div key={si} style={{marginBottom:4}}><ScorerPicker value={(res.awayScorers||[])[si]||""} onChange={v=>{const a=[...(res.awayScorers||[])];a[si]=v;setMatchResult(m.id,"awayScorers",a);}} squad={aSq} placeholder={`Goal ${si+1}`}/></div>)}
                  </div>
                </div>}
              </div>;
            })}
          </Section>

          {/* ── Edit a player's predictions ── */}
          <Section title="EDIT PLAYER PREDICTIONS">
            <div style={{fontSize:11,color:T.dim,marginBottom:10}}>Change any player's picks — works even after the deadline has passed.</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              <select value={editPredLeague} onChange={e=>{setEditPredLeague(e.target.value);setEditPredUser("");}} style={{flex:1,...inp(),padding:"9px 12px",fontSize:13,cursor:"pointer",minWidth:130}}>
                <option value="">Select league…</option>
                {Object.entries(leagues).map(([lid,lg])=><option key={lid} value={lid}>{lg.name}</option>)}
              </select>
              <select value={editPredUser} onChange={e=>setEditPredUser(e.target.value)} disabled={!editPredLeague} style={{flex:1,...inp(),padding:"9px 12px",fontSize:13,cursor:editPredLeague?"pointer":"default",minWidth:130}}>
                <option value="">Select player…</option>
                {editPredLeague&&Object.keys(users).filter(u=>isSuperAdmin(u)||(users[u]?.leagues||[]).includes(editPredLeague)).map(u=><option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {editPredLeague&&editPredUser&&<>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{phases.map(ph=><Pill key={ph} active={editPredPhase===ph} onClick={()=>setEditPredPhase(ph)}>{ph}</Pill>)}</div>
              {(editPredPhase==="All"?matches:matches.filter(m=>m.phase===editPredPhase)).map(m=>{
                const pred=predictions[editPredLeague]?.[editPredUser]?.[m.id]||{};
                const ph=parseInt(pred.homeScore)||0,pa=parseInt(pred.awayScore)||0;
                const hS=Math.min(ph,8),aS=Math.min(pa,8);
                const hSq=DEFAULT_SQUADS[m.home]||{},aSq=DEFAULT_SQUADS[m.away]||{};
                return <div key={m.id} style={{background:"rgba(232,192,0,.04)",border:"1px solid rgba(232,192,0,.12)",borderRadius:10,padding:"11px 13px",marginBottom:7}}>
                  <div style={{fontSize:9,color:T.gold,fontWeight:700,marginBottom:6}}>{m.phase} · {m.date}</div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:hS||aS?10:0}}>
                    <div style={{flex:1,fontWeight:600,fontSize:13}}>{m.home}</div>
                    <input type="number" min="0" max="20" value={pred.homeScore??""} onChange={e=>{setPredFor(editPredLeague,editPredUser,m.id,"homeScore",e.target.value);setPredFor(editPredLeague,editPredUser,m.id,"homeScorers",[]);}} style={{width:42,textAlign:"center",...inp(true),padding:"6px 2px",color:T.gold,fontSize:17,fontWeight:700}}/>
                    <span style={{color:"#3a4a6a",fontWeight:700}}>–</span>
                    <input type="number" min="0" max="20" value={pred.awayScore??""} onChange={e=>{setPredFor(editPredLeague,editPredUser,m.id,"awayScore",e.target.value);setPredFor(editPredLeague,editPredUser,m.id,"awayScorers",[]);}} style={{width:42,textAlign:"center",...inp(true),padding:"6px 2px",color:T.gold,fontSize:17,fontWeight:700}}/>
                    <div style={{flex:1,fontWeight:600,fontSize:13,textAlign:"right"}}>{m.away}</div>
                  </div>
                  {(hS>0||aS>0)&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <div style={{fontSize:10,color:T.dim,fontWeight:700,marginBottom:4}}>⚽ {m.home} ({hS})</div>
                      {Array.from({length:hS}).map((_,si)=><div key={si} style={{marginBottom:4}}><ScorerPicker value={(pred.homeScorers||[])[si]||""} onChange={v=>{const a=[...(pred.homeScorers||[])];a[si]=v;setPredFor(editPredLeague,editPredUser,m.id,"homeScorers",a);}} squad={hSq} placeholder={`Goal ${si+1}`}/></div>)}
                    </div>
                    <div>
                      <div style={{fontSize:10,color:T.dim,fontWeight:700,marginBottom:4}}>⚽ {m.away} ({aS})</div>
                      {Array.from({length:aS}).map((_,si)=><div key={si} style={{marginBottom:4}}><ScorerPicker value={(pred.awayScorers||[])[si]||""} onChange={v=>{const a=[...(pred.awayScorers||[])];a[si]=v;setPredFor(editPredLeague,editPredUser,m.id,"awayScorers",a);}} squad={aSq} placeholder={`Goal ${si+1}`}/></div>)}
                    </div>
                  </div>}
                </div>;
              })}
            </>}
          </Section>

          {/* ── All users ── */}
          <Section title={`ALL PLAYERS (${Object.keys(users).length})`}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
              {Object.entries(users).map(([name,data])=><div key={name} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 14px"}}>
                <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{name}</div>
                {isSuperAdmin(name)&&<div style={{fontSize:10,color:"#ff8c00"}}>⚡ super admin</div>}
                {(data.leagues||[]).map(lid=><span key={lid} style={{display:"inline-block",background:"rgba(232,192,0,.1)",color:T.gold,borderRadius:8,padding:"1px 7px",fontSize:10,margin:"2px 2px 0 0"}}>{leagues[lid]?.name||lid}</span>)}
                {!isSuperAdmin(name)&&<button onClick={async()=>{await fbSet(`users/${name}`,null);showToast(`${name} removed`);}} style={{display:"block",marginTop:6,background:"none",border:"none",color:"#ff4466",cursor:"pointer",fontSize:12,padding:0}}>Remove</button>}
              </div>)}
            </div>
          </Section>
        </div>}
      </div>
    </div>
  );
}

function Section({title,children}){
  return <div style={{marginBottom:32}}>
    <div style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:18,letterSpacing:2,color:"#7a8aaa",marginBottom:14}}>{title}</div>
    {children}
  </div>;
}
