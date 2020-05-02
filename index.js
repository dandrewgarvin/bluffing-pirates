const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const socket = require("socket.io");

const config = require("./config.json");

const shuffle = require("./utils/shuffle");

const app = express();

app.use(bodyParser.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const io = socket(
  app.listen(PORT, () => {
    console.log(`listening on port ${PORT}`);
  })
);

app.use("/", express.static(path.join(__dirname, "./public")));

const rooms = {};

io.on("connection", (socket) => {
  // console.log(
  //   `Socket ${socket.id} has connected from address ${socket.handshake.address}.`
  // );

  socket.on("join room", ({ roomId, name }) => {
    let room = rooms[roomId];
    let player = {
      id: socket.id,
      name,
      wallet: config.startingCurrency,
    };

    if (!room) {
      // create room
      room = {
        id: roomId,
        players: [player],
        matches: [],
      };

      rooms[roomId] = room;
    } else {
      // join room
      const existing = room.players.find((player) => player.id === socket.id);

      if (!existing) {
        // this player is not already in the room. add them.
        room.players.push(player);
      } else {
        // player is already in room.
        socket.emit("already joined");
        return null;
      }
    }

    socket.join(roomId);
    socket.emit("joined room", { player, room });
    socket.to(roomId).emit("player joined", player);
  });

  socket.on("start game", ({ roomId }) => {
    const room = rooms[roomId];

    if (!room) {
      return null;
    }

    io.to(roomId).emit("starting game");

    const { players } = room;

    // randomly shuffle players
    const shuffledPlayers = shuffle(players);

    // generate opponent matchups with match information
    let matches = {};
    shuffledPlayers.forEach((player, indx, arr) => {
      let match = {
        self: player,
        opponent: null,
        pot: config.startingPot,
      };

      if (indx % 2 === 0) {
        // if even index, match with player to the right (if exists)
        if (arr[indx + 1]) {
          match.opponent = arr[indx + 1];
        }
      } else {
        // if odd index, see if current player is already matched up to a previous player

        Object.entries(matches).forEach((entry) => {
          if (entry[1].opponent.id === player.id) {
            // current player already has an opponent assigned
            const opp = room.players.find((player) => player.id === entry[0]);
            match.opponent = opp;
          }
        });
      }

      matches[player.id] = match;

      if (match.opponent) {
        io.to(player.id).emit("match found", match);
      } else {
        io.to(player.id).emit("safe");
      }
    });

    rooms[roomId].matches = matches;

    io.to(roomId).emit("game started", { matches });
  });

  socket.on("match action", ({ roomId, action }) => {
    const room = rooms[roomId];
    const match = room.matches[socket.id];

    if (!room || !match) {
      return null;
    }

    // update self players action
    match.self.action = action;

    console.log(`player ${match.self.name} performed action: ${action}`);

    io.to(match.opponent.id).emit("opponent action");

    // opponent has already acted
    if (match.opponent.action) {
      console.log("opponent has acted already");
      // do logic to figure out the results of the round
      const actions = {
        raise: 0,
        steal: 0,
        shoot: 0,
      };

      actions[match.self.action] += 1;
      actions[match.opponent.action] += 1;

      if (actions.raise === 2) {
        console.log("both playered raised");
        // pot goes up, wallets go down, if any player cannot meet raise amount, game is over
        match.pot += config.raiseAmount * 2;
        match.self.wallet -= config.raiseAmount;
        match.opponent.wallet -= config.raiseAmount;

        if (
          match.self.wallet < config.raiseAmount ||
          match.opponent.wallet < config.raiseAmount
        ) {
          match.ended = true;
          match.winner =
            match.self.wallet < config.raiseAmount
              ? match.self
              : match.opponent;
        }
      } else if (actions.steal === 2) {
        console.log("both players stole");
        // pot is cleared, neither player gets it. if a player cannot meet raise amount, game is over
        match.pot = 0;
        if (
          match.self.wallet < config.raiseAmount ||
          match.opponent.wallet < config.raiseAmount
        ) {
          match.ended = true;
          match.winner =
            match.self.wallet < config.raiseAmount
              ? match.self
              : match.opponent;
        }
      } else if (actions.shoot === 2) {
        console.log("both players shot");
        // pot is clearerd, neither player gets it, game is over.
        match.pot = 0;
        match.ended = true;
        match.winner = null;
      } else if (actions.raise === 1 && actions.steal === 1) {
        console.log("1 player stole, 1 player raised");
        // pot goes to player who stole. if a player cannot meet raise amount, game is over
        if (match.self.action === "steal") {
          match.self.wallet += match.pot;
        } else {
          match.opponent.wallet += match.pot;
        }

        match.pot = 0;

        if (
          match.self.wallet < config.raiseAmount ||
          match.opponent.wallet < config.raiseAmount
        ) {
          match.ended = true;
          match.winner =
            match.self.wallet < config.raiseAmount
              ? match.self
              : match.opponent;
        }
      } else if (actions.raise === 1 && actions.shoot === 1) {
        console.log("1 player raised 1 player shot");
        // pot goes to player who raised. match is ended
        if (match.self.action === "raise") {
          match.self.wallet += match.pot;
          match.winner = match.self;
        } else {
          match.opponent.wallet += match.pot;
          match.winner = match.opponent;
        }

        match.pot = 0;

        match.ended = true;
      } else if (actions.steal === 1 && actions.shoot === 1) {
        console.log("1 player stole 1 player shot");
        // pot goes to player who shot. if a player cannot meet raise amount, game is over
        if (match.self.action === "shoot") {
          match.self.wallet += match.pot;
        } else {
          match.opponent.wallet += match.pot;
        }

        match.pot = 0;

        if (
          match.self.wallet < config.raiseAmount ||
          match.opponent.wallet < config.raiseAmount
        ) {
          match.ended = true;
          match.winner =
            match.self.wallet < config.raiseAmount
              ? match.self
              : match.opponent;
        }
      } else {
        // nothing should happen here
        console.log("BUT SOMETHING HAPPENED ANYWAY");
      }

      if (match.ended) {
        console.log("the match has ended");
        const self = match.self.id;
        const opponent = match.opponent.id;

        // remove match from matches list
        delete room.matches[self];
        delete room.matches[opponent];

        // if all matches in room are ended, re-generate match list

        // let both players know the match is over
        socket.emit("round ended", { ended: true, winner: match.winner });
        io.to(opponent).emit("round ended", {
          ended: true,
          winner: match.winner,
        });

        return null;
      } else {
        console.log("the match has not ended");
      }

      if (match.self.action && match.opponent.action) {
        console.log("both players have acted. ending round");
        delete match.self.action;
        delete match.opponent.action;

        // notify acting player that the round has ended
        const self = { ...match };

        console.log("self", self);

        room.matches[socket.id] = self;
        socket.emit("round ended", self);

        // update opponents match object, then notify them the match is over
        const swap = { ...match };

        swap.self = self.opponent;
        swap.opponent = self.self;
        console.log("swap", swap);

        room.matches[swap.self.id] = swap;

        io.to(swap.self.id).emit("round ended", swap);
      } else {
        console.log("not both players have acted");
      }
    } else {
      console.log("opponent has not yet acted");
    }
  });
});
