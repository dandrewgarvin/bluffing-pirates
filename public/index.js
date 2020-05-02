const socket = io.connect();

let room = {};
let players = [];
let match = null;

const STATUSES = {
  IDLE: "IDLE",
  JOINING_ROOM: "JOINING ROOM",
  IN_GAME: "AWAITING PLAYER ACTION...",
  WAITING: "WAITING FOR OPPONENT...",
  SAFE: "SAFE",
  ENDED: "MATCH ENDED",
};

function init() {
  // generate random room id
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxys1234567890".split(
    ""
  );
  const CODE_LENGTH = 8;
  let roomId = "";

  for (let i = 0; i < CODE_LENGTH; i++) {
    roomId += characters[Math.floor(Math.random() * characters.length)];
  }

  document.getElementById("room_id").value = roomId;
  // document.getElementById("room_id").value = "test";

  // update initial status
  UPDATE_STATUS(STATUSES.IDLE);

  // set up emission receivers
  receiveEmissions();
}

function UPDATE_STATUS(status) {
  const STATUS_ELEMENT = document.getElementById("STATUS");

  if (STATUS_ELEMENT) {
    STATUS_ELEMENT.innerText = "STATUS: " + status;
  }
}

function updatePlayers() {
  const playersListElement = document.getElementById("players");

  while (playersListElement.hasChildNodes()) {
    playersListElement.removeChild(playersListElement.lastChild);
  }

  // enable the start button
  if (players.length >= 2) {
    document.getElementById("start").disabled = false;
  }

  players.forEach((player) => {
    const playerElement = document.createElement("li");
    playerElement.innerText = player.name;
    playersListElement.appendChild(playerElement);
  });
}

function receiveEmissions() {
  socket.on("joined room", (data) => {
    UPDATE_STATUS(STATUSES.IDLE);
    room = data.room;
    players = data.room.players;

    updatePlayers();
  });

  socket.on("player joined", (player) => {
    players.push(player);

    updatePlayers();
  });

  socket.on("already joined", () => {
    UPDATE_STATUS(STATUSES.IDLE);
  });

  socket.on("starting game", () => {
    UPDATE_STATUS(STATUSES.WAITING);
  });

  socket.on("match found", (newMatch) => {
    UPDATE_STATUS(STATUSES.IN_GAME);
    match = newMatch;

    // show match UI
    const matchElement = document.getElementById("match");
    matchElement.style.display = "grid";

    const selfWallet = document.getElementById("self-wallet");
    const pot = document.getElementById("pot");
    const opponentWallet = document.getElementById("opponent-wallet");

    selfWallet.innerText = match.self.wallet;
    pot.innerText = match.pot;
    opponentWallet.innerText = match.opponent.wallet;
  });

  socket.on("safe", () => {
    UPDATE_STATUS(STATUSES.SAFE);

    // hide match UI
    match = null;
    const matchElement = document.getElementById("match");
    matchElement.style.display = "none";
  });

  socket.on("game started", ({ matches }) => {
    // console.log("matches", matches);
  });

  socket.on("opponent action", () => {
    document.getElementById("opponent-action").style.display = "block";
  });

  socket.on("round ended", (match) => {
    UPDATE_STATUS(STATUSES.WAITING);

    if (match.ended) {
      console.log("Match Ended:", match);
      alert(
        `The match has ended! ${
          match.winner
            ? `${match.winner.name} has won!`
            : "There are no winners."
        }`
      );
    } else {
      // hide action buttons
      document.getElementById("self-action").style.display = "none";
      document.getElementById("opponent-action").style.display = "none";

      // adjust player wallets and pot amount
      document.getElementById("self-wallet").innerText = match.self.wallet;
      document.getElementById("pot").innerText = match.pot;
      document.getElementById("opponent-wallet").innerText =
        match.opponent.wallet;

      // re-enable action buttons
    }
  });
}

function join() {
  UPDATE_STATUS(STATUSES.JOINING_ROOM);
  const roomId = document.getElementById("room_id").value;
  const name = document.getElementById("player_name").value;

  socket.emit("join room", { roomId, name });
}

function start() {
  socket.emit("start game", { roomId: room.id });
}

function handlePlayerAction(action) {
  UPDATE_STATUS(STATUSES.WAITING);

  // set self players display action to true
  document.getElementById("self-action").style.display = "block";

  // run the players chosen action
  socket.emit("match action", { roomId: room.id, action });
}

init();
