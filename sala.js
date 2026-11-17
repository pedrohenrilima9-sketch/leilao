document.addEventListener("DOMContentLoaded", () => {
 const $ = id => document.getElementById(id);
 const status = $("status");

 let peer = null, host = false, roomCode = "", myName = "", hostConn = null, clientId = "";
 let connections = [], state = null, timerId = null, ended = false;

 const PEER_PREFIX = "lf-futebol-sala-";
 const peerConfig = {
  config: {
   iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
   ]
  }
 };

 const formacoes = {
  "4-3-3":   [["PE","ATA","PD"], ["MC","MC","MEI"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "4-2-3-1": [["ATA"], ["PE","MEI","PD"], ["VOL","VOL"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "4-4-2":   [["ATA","ATA"], ["MEI","MC","MC","MEI"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "3-5-2":   [["ATA","ATA"], ["MEI","MC","VOL","MC","MEI"], ["ZAG","ZAG","ZAG"], ["GOL"]],
  "3-4-3":   [["PE","ATA","PD"], ["MC","MC","MEI","MEI"], ["ZAG","ZAG","ZAG"], ["GOL"]]
 };

 const nomesPosicao = {
  GOL: "Goleiro", LE: "Lateral Esquerdo", LD: "Lateral Direito", ZAG: "Zagueiro",
  VOL: "Volante", MC: "Meio-Campista", MEI: "Meia Ofensivo", PE: "Ponta Esquerdo",
  PD: "Ponta Direito", ATA: "Atacante / CA"
 };

 const compatibilidade = {
  GOL: ["GOL"], LE: ["LE"], LD: ["LD"], ZAG: ["ZAG"],
  VOL: ["VOL", "MC"], MC: ["MC", "VOL", "MEI"], MEI: ["MEI", "MC", "PE", "PD"],
  PE: ["PE", "MEI", "ATA"], PD: ["PD", "MEI", "ATA"], ATA: ["ATA", "PE", "PD"]
 };

 const ordemPosicoesCiclo = [
  { label: "ATACANTE", posicoes: ["ATA"] },
  { label: "PONTA", posicoes: ["PE", "PD"] },
  { label: "MEIA", posicoes: ["MC", "MEI"] },
  { label: "VOLANTE", posicoes: ["VOL"] },
  { label: "ZAGUEIRO", posicoes: ["ZAG"] },
  { label: "LATERAL", posicoes: ["LE", "LD"] },
  { label: "GOLEIRO", posicoes: ["GOL"] }
 ];

 const fmt = n => "€ " + Math.round(n || 0).toLocaleString("pt-BR");
 function msg(t) { $("mensagem").textContent = t; }
 function message(txt, error=false){ status.textContent = txt; status.style.color = error ? "#ffb4b4" : "#bfe5ff"; }
 function makeCode(){ return String(Math.floor(100000 + Math.random() * 900000)); }
 function cleanName(v){ return (v || "").trim().slice(0, 18); }
 function clientKey(){ return "guest-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7); }
 function playersList() { return typeof jogadores !== "undefined" ? jogadores : []; }
 function currentUserId() { return host ? "host" : clientId; }
 function myPlayer() { return state?.players?.[currentUserId()] || null; }

 $("codigoSala").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
 });

 function broadcast(data) {
  connections = connections.filter(c => c && c.open);
  connections.forEach(c => {
   try { c.send(data); } catch(e) {}
  });
 }

 function sendToHost(data) {
  if (host) {
   handleHostMessage(data, "host");
  } else if (hostConn && hostConn.open) {
   hostConn.send(data);
  }
 }

 function publish() {
  renderAll();
  if (host) {
   broadcast({ type: "state", state });
  }
 }

 // LOBBY
 function showLobbyRoom() {
  $("salaAtiva").classList.remove("escondido");
  $("codigoExibido").textContent = roomCode;
  $("avisoAnfitriao").textContent = host
   ? "Você é o anfitrião. Compartilhe o código numérico acima e clique em Iniciar leilão quando todos entrarem."
   : "Conectado! Aguardando o anfitrião iniciar o leilão.";
  $("iniciarLeilao").classList.toggle("escondido", !host);
  renderLobbyPlayers();
 }

 function renderLobbyPlayers() {
  if (!state) return;
  $("listaParticipantes").innerHTML = "";
  Object.values(state.players || {}).forEach(p => {
   if (p.isBot) return;
   const li = document.createElement("li");
   li.textContent = p.name + (p.id === "host" ? " • Anfitrião" : "");
   $("listaParticipantes").appendChild(li);
  });
 }

 function setupHost() {
  state = {
   roomCode,
   players: {
    host: { id: "host", name: myName, budget: 500000000, roster: [], lineup: {}, formation: "4-3-3" }
   },
   auction: null,
   history: [],
   used: [],
   cycleIndex: 0,
   started: false,
   finished: false,
   paused: false,
   tournament: null,
   seconds: 10
  };

  peer = new Peer(PEER_PREFIX + roomCode, peerConfig);

  peer.on("open", () => {
   message("Sala criada! Código numérico: " + roomCode);
   showLobbyRoom();
  });

  peer.on("connection", conn => {
   connections.push(conn);

   conn.on("data", data => {
    if (!data) return;
    if (data.type === "hello") {
     const id = data.clientId || conn.peer;
     const humanCount = Object.values(state.players).filter(p => !p.isBot).length;
     if (humanCount >= 16 && !state.players[id]) {
      try { conn.send({ type: "error", message: "A sala já está cheia (máx. 16 jogadores)." }); } catch(e) {}
      setTimeout(() => conn.close(), 300);
      return;
     }
     if (!state.players[id]) {
      state.players[id] = {
       id,
       name: cleanName(data.name) || "Jogador",
       budget: 500000000,
       roster: [],
       lineup: {},
       formation: "4-3-3"
      };
     }
     conn.playerId = id;
     publish();
     try { conn.send({ type: "state", state }); } catch(e) {}
     message(state.players[id].name + " entrou na sala!");
    } else {
     handleHostMessage(data, conn.playerId || conn.peer);
    }
   });

   conn.on("close", () => {
    if (conn.playerId && state.players[conn.playerId] && !state.started) {
     delete state.players[conn.playerId];
     publish();
    }
   });
  });

  peer.on("error", err => {
   if (err.type === "unavailable-id") {
    peer.destroy();
    roomCode = makeCode();
    setupHost();
   } else {
    message("Erro ao criar sala: " + err.type, true);
   }
  });
 }

 $("criarSala").addEventListener("click", () => {
  if (peer) return;
  myName = cleanName($("nomeCriador").value);
  if (!myName) { message("Digite seu nome antes de criar a sala.", true); return; }
  host = true;
  roomCode = makeCode();
  message("Criando sala...");
  setupHost();
 });

 $("entrarSala").addEventListener("click", () => {
  if (peer) return;
  myName = cleanName($("nomeConvidado").value);
  roomCode = $("codigoSala").value.replace(/\D/g, "").trim();
  if (!myName || !/^\d{6}$/.test(roomCode)) {
   message("Informe seu nome e os 6 números do código da sala.", true);
   return;
  }
  message("Conectando à sala " + roomCode + "...");
  clientId = clientKey();
  peer = new Peer(clientId, peerConfig);

  peer.on("open", () => {
   let connected = false;
   hostConn = peer.connect(PEER_PREFIX + roomCode, { reliable: true });

   hostConn.on("open", () => {
    connected = true;
    hostConn.send({ type: "hello", name: myName, clientId });
   });

   hostConn.on("data", data => {
    if (!data) return;
    if (data.type === "state") {
     state = data.state;
     host = false;
     renderAll();
     if (state.finished) {
      renderMataMataBracket();
      renderTabelaArtilheiros();
     }
     if (!state.started) {
      message("Conectado com sucesso à sala " + roomCode + "!");
     }
    }
    if (data.type === "finishTournament") {
     state.finished = true;
     state.auction = null;
     if (data.tournament) {
      state.tournament = data.tournament;
     }
     if (data.state) {
      state = data.state;
     }
     host = false;
     renderAll();
     renderMataMataBracket();
     renderTabelaArtilheiros();
    }
    if (data.type === "error") {
     message(data.message, true);
    }
   });

   hostConn.on("close", () => {
    message("Conexão encerrada pelo anfitrião.", true);
    $("conexao").textContent = "Conexão encerrada pelo anfitrião.";
   });

   setTimeout(() => {
    if (!connected) {
     message("Sala não encontrada ou demorando a responder. Verifique o código de 6 números.", true);
     if (peer) { peer.destroy(); peer = null; }
    }
   }, 8000);
  });

  peer.on("error", err => {
   message("Não foi possível conectar (" + err.type + "). Verifique o número da sala.", true);
   if (peer) { peer.destroy(); peer = null; }
  });
 });

 $("copiarCodigo").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(roomCode); message("Código " + roomCode + " copiado!"); }
  catch(e) { message("Código da sala: " + roomCode); }
 });

 $("iniciarLeilao").addEventListener("click", () => {
  if (!host || !state) return;
  startAuction();
 });

 // RENDERIZAÇÃO GERAL
 function renderAll() {
  if (!state) return;

  if (!state.started) {
   $("telaLobby").classList.remove("escondido");
   $("telaJogo").classList.add("escondido");
   showLobbyRoom();
   return;
  }

  $("telaLobby").classList.add("escondido");
  $("telaJogo").classList.remove("escondido");
  renderGame();
 }

 function getFormationSlots(formacao) {
  const rows = formacoes[formacao] || formacoes["4-3-3"];
  const slots = [];
  let idx = 0;
  rows.forEach((row, rIdx) => {
   row.forEach((pos, cIdx) => { slots.push({ id: "slot-" + idx++, pos, row: rIdx, col: cIdx }); });
  });
  return slots;
 }

 function isCompatible(slotPos, playerPos) {
  return (compatibilidade[slotPos] || [slotPos]).includes(playerPos);
 }

 function countLineup(player) {
  if (!player || !player.lineup) return 0;
  return Object.keys(player.lineup).length;
 }

 function calcularOverallMedio(playerObj) {
  const lineup = playerObj.lineup || {};
  const titulares = Object.values(lineup);
  if (titulares.length === 0) return 0;
  const soma = titulares.reduce((acc, j) => acc + (j.overall || 75), 0);
  return soma / titulares.length;
 }

 function renderCampoVisual(me, containerId, interactive) {
  const formacaoAtual = me.formation || "4-3-3";
  const lineup = me.lineup || {};
  const rows = formacoes[formacaoAtual] || formacoes["4-3-3"];
  const campo = $(containerId);
  campo.innerHTML = "";
  let idx = 0;

  rows.forEach(row => {
   const line = document.createElement("div");
   line.className = "linha-jogadores";
   row.forEach(pos => {
    const slotId = "slot-" + idx++;
    const jog = lineup[slotId];
    const card = document.createElement("div");
    card.className = "card-jogador" + (jog ? "" : " vazio");
    if (!interactive) card.style.cursor = "default";

    if (jog) {
     card.innerHTML = `<div class="foto-jogador">${jog.nome[0]}</div><strong>${jog.nome}</strong><span class="posicao">${pos} (${jog.posicao})</span><span class="perna-tag">Perna: ${jog.pernaBoa ? jog.pernaBoa[0] : "D"}</span><small>${jog.overall} ⭐</small>`;
    } else {
     card.innerHTML = `<div class="foto-jogador">+</div><strong>Vaga ${pos}</strong><span class="posicao">${nomesPosicao[pos] || pos}</span><small>${interactive ? "Clique p/ escalar" : "Vazio"}</small>`;
    }

    if (interactive) {
     card.onclick = () => abrirModalVaga(slotId, pos);
    }
    line.appendChild(card);
   });
   campo.appendChild(line);
  });
 }

 function renderBancoVisual(me, containerId, interactive) {
  const lineup = me.lineup || {};
  const escaladosNomes = new Set(Object.values(lineup).map(j => j.nome));
  const banco = (me.roster || []).filter(j => !escaladosNomes.has(j.nome));
  const listaBanco = $(containerId);
  listaBanco.innerHTML = "";

  if (!banco.length) {
   listaBanco.innerHTML = `<p style="color:#8ca4bb;font-size:12px">Nenhum jogador aguardando no banco.</p>`;
  } else {
   banco.forEach(j => {
    const item = document.createElement("div");
    item.className = "item-banco";
    if (!interactive) item.style.cursor = "default";
    item.innerHTML = `<div><strong>${j.nome}</strong> <small style="color:#27aaff">(${j.posicao} • Perna: ${j.pernaBoa || "Direita"})</small></div><span>${j.overall} ⭐</span>`;
    if (interactive) {
     item.onclick = () => abrirModalJogadorParaVaga(j);
    }
    listaBanco.appendChild(item);
   });
  }
 }

 function renderGame() {
  $("roomLabel").textContent = "Sala " + roomCode;
  $("conexao").textContent = host ? "Anfitrião do Torneio" : "Conectado ao Anfitrião";

  const me = myPlayer();
  $("saldo").textContent = fmt(me?.budget);

  if (me) {
   const ovrMain = calcularOverallMedio(me);
   $("titularesCount").textContent = countLineup(me);
   $("mediaOverallMain").textContent = ovrMain.toFixed(1);
   $("formacaoAtualLabel").textContent = me.formation || "4-3-3";
   renderCampoVisual(me, "campoJogadoresPrincipal", false);
   renderBancoVisual(me, "listaBancoPrincipal", false);
  }

  $("areaControleAnfitriao").classList.toggle("escondido", !host);
  if (host) {
   $("botaoPausaGlobal").textContent = state.paused ? "▶️ Retomar Leilão" : "⏸️ Pausar Leilão (Arrumar Time)";
  }

  if (state.paused && !state.finished) {
   const ovrModal = me ? calcularOverallMedio(me) : 0;
   $("mediaOverallModal").textContent = ovrModal.toFixed(1);
   $("titularesModalCount").textContent = (me ? countLineup(me) : 0) + " / 11";
   $("modalPausaGlobal").classList.add("ativo");

   if (me) {
    const formacaoAtual = me.formation || "4-3-3";
    if ($("formacaoModal").value !== formacaoAtual) { $("formacaoModal").value = formacaoAtual; }
    renderCampoVisual(me, "campoJogadoresModal", true);
    renderBancoVisual(me, "listaBancoModal", true);
   }

   const areaRetomar = $("areaBotaoRetomar");
   areaRetomar.innerHTML = "";
   if (host) {
    const btnRet = document.createElement("button");
    btnRet.textContent = "▶️ Retomar Leilão (Salvar Alterações)";
    btnRet.style.width = "100%";
    btnRet.style.maxWidth = "420px";
    btnRet.style.background = "linear-gradient(90deg,#00b8ff,#007bd1)";
    btnRet.style.padding = "14px";
    btnRet.style.fontWeight = "bold";
    btnRet.style.borderRadius = "8px";
    btnRet.onclick = () => sendToHost({ type: "togglePause" });
    areaRetomar.appendChild(btnRet);
   } else {
    const pInfo = document.createElement("p");
    pInfo.style.color = "#ffaa00";
    pInfo.style.textAlign = "center";
    pInfo.style.fontWeight = "bold";
    pInfo.textContent = "Suas mudanças estão salvas! Aguardando o anfitrião retomar o leilão...";
    areaRetomar.appendChild(pInfo);
   }
  } else {
   $("modalPausaGlobal").classList.remove("ativo");
  }

  $("participantes").innerHTML = "";
  Object.values(state.players || {}).forEach(p => {
   if (p.isBot) return;
   const li = document.createElement("li");
   const esc = countLineup(p);
   const ovr = calcularOverallMedio(p).toFixed(1);
   li.textContent = `${p.name} — ${fmt(p.budget)} • Titulares: ${esc}/11 • OVR: ${ovr}`;
   $("participantes").appendChild(li);
  });

  $("historico").innerHTML = "";
  (state.history || []).slice(-10).reverse().forEach(item => {
   const li = document.createElement("li");
   li.textContent = item;
   $("historico").appendChild(li);
  });

  if (state.finished) {
   $("areaLeilao").classList.add("escondido");
   $("secTimePrincipal").classList.add("escondido");
   $("resultados").classList.remove("escondido");
   renderMataMataBracket();
   renderTabelaArtilharia();
  } else {
   $("areaLeilao").classList.remove("escondido");
   $("secTimePrincipal").classList.remove("escondido");
   $("resultados").classList.add("escondido");
  }

  if (state.auction && !state.finished && !state.paused) {
   const a = state.auction;
   $("etiquetaCiclo").textContent = `JOGADOR EM LEILÃO • POSIÇÃO: ${a.cycleLabel || a.player.posicao}`;
   $("nomeJogador").textContent = a.player.nome;
   $("dadosJogador").textContent = `${nomesPosicao[a.player.posicao] || a.player.posicao} (${a.player.posicao}) • Perna: ${a.player.pernaBoa} • Overall ${a.player.overall}`;
   $("avatar").textContent = a.player.posicao === "GOL" ? "🧤" : "⚽";
   $("maiorLance").textContent = fmt(a.highestBid);
   const bidder = state.players[a.highestBidder];
   $("maiorLicitante").textContent = bidder ? bidder.name : "Nenhum lance ainda (Começa em € 0)";
   $("timer").textContent = state.seconds + "s";

   $("darLance").disabled = !me || me.budget < (a.highestBid + 1000000);
   $("darLance5").disabled = !me || me.budget < (a.highestBid + 5000000);
   $("darLance10").disabled = !me || me.budget < (a.highestBid + 10000000);
   $("passar").disabled = false;
  } else if (state.paused) {
   $("timer").textContent = "PAUSADO";
   $("darLance").disabled = true;
   $("darLance5").disabled = true;
   $("darLance10").disabled = true;
   $("passar").disabled = true;
  }
 }

 $("darLance").addEventListener("click", () => sendToHost({ type: "bid", increment: 1000000 }));
 $("darLance5").addEventListener("click", () => sendToHost({ type: "bid", increment: 5000000 }));
 $("darLance10").addEventListener("click", () => sendToHost({ type: "bid", increment: 10000000 }));
 $("passar").addEventListener("click", () => msg("Você passou nesta rodada."));

 $("botaoPausaGlobal").addEventListener("click", () => {
  if (!host) return;
  sendToHost({ type: "togglePause" });
 });

 $("botaoEncerrarLeilao").addEventListener("click", () => {
  if (!host) return;
  if (confirm("Deseja encerrar o leilão e iniciar o torneio de mata-mata?")) {
   sendToHost({ type: "finishAuction" });
  }
 });

 function abrirModalVaga(slotId, slotPos) {
  if (state.finished) return;
  const me = myPlayer();
  if (!me) return;

  const lineup = me.lineup || {};
  const atualNaVaga = lineup[slotId];
  const escaladosOutros = new Set(Object.entries(lineup).filter(([k]) => k !== slotId).map(([, v]) => v.nome));
  const compativeis = (me.roster || []).filter(j => isCompatible(slotPos, j.posicao) && !escaladosOutros.has(j.nome));

  $("posicaoSelecionada").textContent = `Vaga: ${nomesPosicao[slotPos] || slotPos} (${slotPos})`;
  const container = $("opcoesJogadores");
  container.innerHTML = "";

  if (atualNaVaga) {
   const btnRemover = document.createElement("button");
   btnRemover.className = "opcao-jogador secundario";
   btnRemover.innerHTML = `<strong>Remover ${atualNaVaga.nome}</strong><span>Mandar p/ Banco</span>`;
   btnRemover.onclick = () => { sendToHost({ type: "unassignSlot", slotId }); fecharModaisAux(); };
   container.appendChild(btnRemover);
  }

  if (!compativeis.length) {
   const p = document.createElement("p"); p.style.color = "#ffb4b4"; p.style.fontSize = "13px";
   p.textContent = "Sem jogadores compatíveis disponíveis no banco."; container.appendChild(p);
  } else {
   compativeis.forEach(j => {
    const b = document.createElement("button"); b.className = "opcao-jogador";
    b.innerHTML = `<strong>${j.nome} (${j.posicao} • Perna: ${j.pernaBoa})</strong><span>${j.overall} ⭐</span>`;
    b.onclick = () => { sendToHost({ type: "assignSlot", slotId, playerName: j.nome }); fecharModaisAux(); };
    container.appendChild(b);
   });
  }
  $("modalJogadores").classList.add("ativo");
 }

 function abrirModalJogadorParaVaga(jogador) {
  if (state.finished) return;
  const me = myPlayer(); if (!me) return;
  const slots = getFormationSlots(me.formation || "4-3-3");
  const lineup = me.lineup || {};
  const slotsCompativeis = slots.filter(s => isCompatible(s.pos, jogador.posicao));

  $("jogadorParaEscalar").textContent = `${jogador.nome} (${jogador.posicao} • Perna: ${jogador.pernaBoa} • ${jogador.overall} ⭐)`;
  const container = $("opcoesPosicoes"); container.innerHTML = "";

  if (!slotsCompativeis.length) {
   const p = document.createElement("p"); p.style.color = "#ffb4b4"; p.style.fontSize = "13px";
   p.textContent = "Nenhuma posição compatível na formação atual."; container.appendChild(p);
  } else {
   slotsCompativeis.forEach(s => {
    const ocupante = lineup[s.id];
    const b = document.createElement("button"); b.className = "opcao-jogador";
    b.innerHTML = `<strong>${nomesPosicao[s.pos] || s.pos} (${s.pos})</strong><span>${ocupante ? "Trocar " + ocupante.nome : "Vaga livre"}</span>`;
    b.onclick = () => { sendToHost({ type: "assignSlot", slotId: s.id, playerName: jogador.nome }); fecharModaisAux(); };
    container.appendChild(b);
   });
  }
  $("modalPosicoes").classList.add("ativo");
 }

 function fecharModaisAux() {
  $("modalJogadores").classList.remove("ativo");
  $("modalPosicoes").classList.remove("ativo");
 }

 $("fecharModal").onclick = fecharModaisAux;
 $("fecharModalPos").onclick = fecharModaisAux;
 window.onclick = e => {
  if (e.target === $("modalJogadores")) fecharModaisAux();
  if (e.target === $("modalPosicoes")) fecharModaisAux();
 };

 $("formacaoModal").addEventListener("change", e => {
  sendToHost({ type: "setFormation", formation: e.target.value });
 });

 // CONTROLE DE ABAS DE RESULTADOS
 window.mudarAbaResultados = function(aba) {
  const isMata = aba === 'matamata';
  $("btnTabMataMata").classList.toggle("ativa", isMata);
  $("btnTabArtilharia").classList.toggle("ativa", !isMata);
  $("conteudoMataMata").classList.toggle("escondido", !isMata);
  $("conteudoArtilharia").classList.toggle("escondido", isMata);
 };

 // SIMULAÇÃO COM ARTILHEIROS E MINUTOS DOS GOLS
 function computeTournament() {
  const playersArr = Object.values(state.players || {}).filter(p => !p.isBot);
  let teams = playersArr.map(p => {
   const ovrMedio = calcularOverallMedio(p) || 75;
   const lineupArr = Object.values(p.lineup || {});
   return { id: p.id, name: p.name, forca: ovrMedio, lineup: lineupArr };
  });

  const botNames = ["Craque Bot", "Tite Bot", "Guardiola Bot", "Ancelotti Bot", "Abel Bot", "Jürgen Bot", "Mourinho Bot", "Xavi Bot", "Klopp Bot", "Zidane Bot", "Cafu Bot", "Ronaldo Bot", "Pelé Bot", "Kaká Bot", "Ronaldinho Bot", "Zagallo Bot"];
  let bIdx = 0;
  while(teams.length < 16) {
   const botOvr = Math.floor(76 + Math.random() * 8);
   teams.push({ id: "bot-"+bIdx, name: botNames[bIdx++] + " (" + botOvr + ")", forca: botOvr, lineup: [] });
  }
  teams.sort(() => Math.random() - 0.5);

  let artilheirosMap = {};

  function registrarGols(teamObj, numGoals) {
   if (numGoals <= 0) return "";
   let pool = teamObj.lineup && teamObj.lineup.length > 0 ? teamObj.lineup : [{ nome: teamObj.name, posicao: "TIME" }];
   let scorersList = [];
   for (let i = 0; i < numGoals; i++) {
    let chosenPlayer = pool[Math.floor(Math.random() * pool.length)];
    let scorerName = chosenPlayer.nome;
    let minute = Math.floor(1 + Math.random() * 90);
    scorersList.push(`${scorerName} (${minute}')`);

    // Atualiza tabela geral de artilheiros
    if (!artilheirosMap[scorerName]) {
     artilheirosMap[scorerName] = { nome: scorerName, time: teamObj.name, gols: 0 };
    }
    artilheirosMap[scorerName].gols++;
   }
   return scorersList.join(", ");
  }

  function simulateMatch(t1, t2) {
   const diff = (t1.forca - t2.forca);
   const g1 = Math.max(0, Math.round(1.4 + (diff * 0.25) + (Math.random() * 2.2 - 1.1)));
   const g2 = Math.max(0, Math.round(1.4 - (diff * 0.25) + (Math.random() * 2.2 - 1.1)));

   let details1 = registrarGols(t1, g1);
   let details2 = registrarGols(t2, g2);

   if (g1 !== g2) {
    const winner = g1 > g2 ? t1 : t2;
    return { t1, t2, winner, score: `${g1} × ${g2}`, details1, details2 };
   }

   const probT1 = 0.5 + Math.max(-0.35, Math.min(0.35, diff * 0.05));
   const winner = Math.random() < probT1 ? t1 : t2;
   return { t1, t2, winner, score: `${g1} × ${g2} (pên.)`, details1, details2 };
  }

  let oitavas = [], vencedoresOitavas = [];
  for(let i=0; i<16; i+=2) {
   const res = simulateMatch(teams[i], teams[i+1]);
   oitavas.push(res);
   vencedoresOitavas.push(res.winner);
  }

  let quartas = [], vencedoresQuartas = [];
  for(let i=0; i<8; i+=2) {
   const res = simulateMatch(vencedoresOitavas[i], vencedoresOitavas[i+1]);
   quartas.push(res);
   vencedoresQuartas.push(res.winner);
  }

  let semis = [], vencedoresSemis = [];
  for(let i=0; i<4; i+=2) {
   const res = simulateMatch(vencedoresQuartas[i], vencedoresQuartas[i+1]);
   semis.push(res);
   vencedoresSemis.push(res.winner);
  }

  const finalRes = simulateMatch(vencedoresSemis[0], vencedoresSemis[1]);

  // Transforma o map de artilheiros em array ordenado
  let artilheirosArray = Object.values(artilheirosMap).sort((a, b) => b.gols - a.gols);

  return { oitavas, quartas, semis, final: finalRes, artilheiros: artilheirosArray };
 }

 function renderMataMataBracket() {
  if (!state.tournament) {
   if (host) {
    state.tournament = computeTournament();
    publish();
   } else {
    return;
   }
  }

  const t = state.tournament;
  const container = $("bracketContainer");
  container.innerHTML = "";

  function createPhaseCol(title, matches) {
   const col = document.createElement("div");
   col.className = "fase-col";
   col.innerHTML = `<h3>${title}</h3>`;
   matches.forEach(m => {
    const div = document.createElement("div");
    div.className = "jogo-mata";
    const v1 = m.winner.id === m.t1.id ? "vencedor" : "";
    const v2 = m.winner.id === m.t2.id ? "vencedor" : "";
    div.innerHTML = `
     <div class="time-jogo ${v1}"><span>${m.t1.name}</span><span>${m.score.split("×")[0]}</span></div>
     <div class="time-jogo ${v2}"><span>${m.t2.name}</span><span>${m.score.split("×")[1] || ""}</span></div>
     <div class="gols-detalhe">⚽ ${m.t1.name}: ${m.details1 || "Nenhum"}</div>
     <div class="gols-detalhe">⚽ ${m.t2.name}: ${m.details2 || "Nenhum"}</div>
    `;
    col.appendChild(div);
   });
   return col;
  }

  container.appendChild(createPhaseCol("⚡ Oitavas de Final", t.oitavas));
  container.appendChild(createPhaseCol("🔥 Quartas de Final", t.quartas));
  container.appendChild(createPhaseCol("⭐ Semifinais", t.semis));
  
  const finalCol = document.createElement("div");
  finalCol.className = "fase-col";
  finalCol.innerHTML = `<h3>🏆 GRANDE FINAL</h3>`;
  const fd = document.createElement("div");
  fd.className = "jogo-mata";
  fd.style.border = "2px solid #5ee0ae";
  const fv1 = t.final.winner.id === t.final.t1.id ? "vencedor" : "";
  const fv2 = t.final.winner.id === t.final.t2.id ? "vencedor" : "";
  fd.innerHTML = `
   <div style="color:#5ee0ae;font-weight:bold;margin-bottom:6px;text-align:center">👑 CAMPEÃO: ${t.final.winner.name}</div>
   <div class="time-jogo ${fv1}"><span>${t.final.t1.name}</span></div>
   <div class="time-jogo ${fv2}"><span>${t.final.t2.name}</span></div>
   <div style="text-align:center;margin-top:6px;color:#27aaff">Placar: ${t.final.score}</div>
   <div class="gols-detalhe">⚽ ${t.final.t1.name}: ${t.final.details1 || "Nenhum"}</div>
   <div class="gols-detalhe">⚽ ${t.final.t2.name}: ${t.final.details2 || "Nenhum"}</div>
  `;
  finalCol.appendChild(fd);
  container.appendChild(finalCol);
 }

 function renderTabelaArtilheiros() {
  if (!state.tournament || !state.tournament.artilheiros) return;
  const tbody = $("corpoTabelaArtilheiros");
  tbody.innerHTML = "";

  state.tournament.artilheiros.forEach((art, index) => {
   const tr = document.createElement("tr");
   tr.innerHTML = `
    <td><strong>#${index + 1}</strong></td>
    <td style="color:#27aaff; font-weight:bold;">${art.nome}</td>
    <td>${art.time}</td>
    <td><strong style="color:#5ee0ae;">${art.gols} ⚽</strong></td>
   `;
   tbody.appendChild(tr);
  });
 }

 function handleHostMessage(data, from) {
  if (!host || !state) return;
  const p = state.players[from]; if (!p) return;

  if (data.type === "togglePause") {
   state.paused = !state.paused;
   state.history.push(state.paused ? "⏸️ Anfitrião pausou o leilão para organizar times!" : "▶️ Anfitrião retomou o leilão!");
   publish();
   return;
  }

  if (data.type === "finishAuction") {
   finishAuction();
   return;
  }

  if (data.type === "bid") {
   if (state.paused) return;
   const a = state.auction;
   const inc = data.increment || 1000000;
   const newBid = a.highestBid + inc;
   if (!a || state.finished || p.budget < newBid) return;

   a.highestBid = newBid;
   a.highestBidder = from;
   state.seconds = 10;
   state.history.push(`${p.name} deu lance de ${fmt(newBid)} em ${a.player.nome}`);
   publish();
   msg(`Novo lance de ${p.name}: ${fmt(newBid)}!`);
  }

  if (data.type === "setFormation") {
   if (!formacoes[data.formation]) return;
   p.formation = data.formation;
   const slots = getFormationSlots(p.formation);
   const old = Object.values(p.lineup || {});
   const newLineup = {};
   old.forEach(jog => {
    const free = slots.find(s => !newLineup[s.id] && isCompatible(s.pos, jog.posicao));
    if (free) newLineup[free.id] = jog;
   });
   p.lineup = newLineup;
   publish();
  }

  if (data.type === "assignSlot") {
   const slots = getFormationSlots(p.formation || "4-3-3");
   const target = slots.find(s => s.id === data.slotId);
   const jogador = (p.roster || []).find(j => j.nome === data.playerName);
   if (!target || !jogador || !isCompatible(target.pos, jogador.posicao)) return;

   p.lineup = p.lineup || {};
   Object.keys(p.lineup).forEach(k => { if (p.lineup[k]?.nome === jogador.nome) delete p.lineup[k]; });
   p.lineup[target.id] = jogador;
   publish();
  }

  if (data.type === "unassignSlot") {
   if (!p.lineup) return;
   delete p.lineup[data.slotId];
   publish();
  }
 }

 function autoPlace(playerObj, novoJogador) {
  const slots = getFormationSlots(playerObj.formation || "4-3-3");
  playerObj.lineup = playerObj.lineup || {};
  const free = slots.find(s => !playerObj.lineup[s.id] && isCompatible(s.pos, novoJogador.posicao));
  if (free) playerObj.lineup[free.id] = novoJogador;
 }

 function pickNextPlayerInOrder() {
  const all = playersList().filter(j => !state.used.includes(j.nome));
  if (!all.length) return null;

  if (typeof state.cycleIndex !== "number") state.cycleIndex = 0;

  for (let attempts = 0; attempts < ordemPosicoesCiclo.length; attempts++) {
   const step = ordemPosicoesCiclo[state.cycleIndex % ordemPosicoesCiclo.length];
   state.cycleIndex = (state.cycleIndex + 1) % ordemPosicoesCiclo.length;

   const candidates = all.filter(j => step.posicoes.includes(j.posicao));
   if (candidates.length > 0) {
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return { player: chosen, cycleLabel: step.label };
   }
  }

  const fallback = all[Math.floor(Math.random() * all.length)];
  return { player: fallback, cycleLabel: fallback.posicao };
 }

 function nextPlayer() {
  if (!host || ended) return;
  if (state.paused) return;

  if (state.auction?.highestBidder) {
   const vencedor = state.players[state.auction.highestBidder];
   const j = state.auction.player;
   if (vencedor) {
    vencedor.budget -= state.auction.highestBid;
    const comprado = { ...j, valor: state.auction.highestBid };
    vencedor.roster.push(comprado);
    autoPlace(vencedor, comprado);
    state.history.push(`${vencedor.name} contratou ${j.nome} por ${fmt(state.auction.highestBid)}`);
   }
  } else if (state.auction) {
   state.history.push(`Ninguém comprou ${state.auction.player.nome} (passou em branco)`);
  }

  const nextPick = pickNextPlayerInOrder();
  if (!nextPick) { finishAuction(); return; }

  state.used.push(nextPick.player.nome);
  state.auction = { player: nextPick.player, cycleLabel: nextPick.cycleLabel, highestBid: 0, highestBidder: null };
  state.seconds = 10;
  publish();
  msg(`Novo ${nextPick.cycleLabel} em leilão! Tempo: 10s`);

  clearInterval(timerId);
  timerId = setInterval(() => {
   if (!host || ended) return;
   if (state.paused) return;
   state.seconds--;
   publish();
   if (state.seconds <= 0) {
    clearInterval(timerId);
    nextPlayer();
   }
  }, 1000);
 }

  function finishAuction() {
  clearInterval(timerId);
  ended = true;
  state.finished = true;
  state.auction = null;
  state.tournament = computeTournament();
  
  // Envia estado E um comando específico para garantir que todos recebam o torneio gerado
  broadcast({ type: "finishTournament", tournament: state.tournament, state });
  publish();
  msg("Leilão encerrado! Chaveamento do mata-mata gerado.");
 }

 function startAuction() {
  if (!host) return;
  state.used = [];
  state.cycleIndex = 0;
  state.history = ["Leilão iniciado! Ordem: Atacante, Ponta, Meia, Volante, Zagueiro, Lateral, Goleiro."];
  state.finished = false;
  state.paused = false;
  state.started = true;
  ended = false;
  nextPlayer();
 }
});
