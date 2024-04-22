const { broadcast } = require("../utils/sse");
const Room = require("../models/roomModel");
const Word = require("../models/wordModel");

const subscribers = {};

// Utils
const startNewRound = async (roomId) => {
  const roomInfo = await Room.findById(roomId);
  roomInfo.status = "playing";

  const word = await Word.aggregate([{ $sample: { size: 1 } }]);
  roomInfo.rounds.push({
    drawer: roomInfo.playerList[0].user._id,
    word: word[0]._id,
  });

  await roomInfo.save();

  sendRoomInfo(roomId);
};

const sendRoomInfo = async (roomId) => {
  const roomInfo = await Room.findById(roomId).populate([
    {
      path: "playerList.user",
      model: "User",
    },
    {
      path: "rounds.drawer",
      model: "User",
    },
    {
      path: "rounds.word",
      model: "Word",
    },
  ]);

  const response = {
    type: "status",
    data: roomInfo,
  };

  if (subscribers[roomId]) {
    broadcast(subscribers[roomId], response);
  }
};

const subscribeChat = async (req, res) => {
  const roomId = req.params.id;

  // Check does room valid
  const roomInfo = await Room.findById(roomId);
  if (roomInfo == null) {
    return res.status(400).json({ success: false, msg: "Room not found" });
  }

  // Store subscriber
  if (!subscribers[roomId]) subscribers[roomId] = [];
  subscribers[roomId].push(res);

  const headers = {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  };
  res.writeHead(200, headers);

  // Initialize Room Info
  if (roomInfo.status == "waiting" && roomInfo.playerList.length >= 2) {
    startNewRound(roomId);
  } else {
    sendRoomInfo(roomId);
  }

  req.on("close", () => {
    res.end();
  });
};

const postDraw = async (req, res) => {
  const roomId = req.params.id;
  const body = req.body;

  const response = {
    type: "draw",
    data: body,
  };
  if (subscribers[roomId]) broadcast(subscribers[roomId], response);

  res.status(200).send("Draw posted");
};

const guessDraw = async (req, res) => {
  const roomId = req.params.id;
  const { answer, userId } = req.body;

  const roomInfo = await Room.findById(roomId).populate([
    {
      path: "playerList.user",
      model: "User",
    },
    {
      path: "rounds.drawer",
      model: "User",
    },
    {
      path: "rounds.word",
      model: "Word",
    },
  ]);

  if (roomInfo == null) {
    return res.status(400).json({ success: false, msg: "Room not found" });
  }

  const currentRound = roomInfo.rounds[roomInfo.rounds.length - 1];
  if (currentRound.word.word == answer) {
    // Update score to Drawer
    const drawerIndex = roomInfo.playerList.findIndex(
      (player) => player.user == currentRound.drawer
    );
    roomInfo.playerList[drawerIndex].score += 100;

    // Update score to Guesser
    const guesserIndex = roomInfo.playerList.findIndex(
      (player) => player.user == userId
    );
    roomInfo.playerList[guesserIndex].score += 100;

    // Add to guesses
    currentRound.guesses.push({ player: userId, guess: answer });

    await roomInfo.save();

    if (currentRound.guesses.length == roomInfo.playerList.length - 1) {
      currentRound.status = "ended";
      await roomInfo.save();
      startNewRound();
    }
  }

  res.status(200).send("Guess posted");
};

const createRoom = async (req, res) => {
  const room = await Room.create(req.body);

  res.status(200).json({ success: true, data: room, msg: "Room created" });
};

const getRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(400).json({ success: false, msg: "Room not found" });
    }

    res.status(200).json({ success: true, data: room });
  } catch (err) {
    console.log(err);
    res.status(400).json({ success: false });
  }
};

const getRooms = async (req, res) => {
  try {
    const rooms = await Room.find();

    res.status(200).json({ success: true, count: rooms.length, data: rooms });
  } catch (err) {
    console.log(err);
    res.status(400).json({ success: false });
  }
};

const updateRoom = async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!room) {
      return res.status(400).json({ success: false, msg: "Room not found" });
    }

    res.status(200).json({ success: true, data: room });
  } catch (err) {
    console.log(err);
    res.status(400).json({ success: false });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);

    if (!room) {
      return res.status(400).json({ success: false, msg: "Can't delete room" });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.log(err);
    res.status(400).json({ success: false });
  }
};

const joinRoom = async (req, res) => {
  const roomId = req.params.id;
  try {
    const room = await Room.findById(roomId);
    if (!room) {
      return res
        .status(400)
        .json({ success: false, msg: "Cannot find the room." });
    }
    if (room.playerList.length >= 4) {
      return res
        .status(400)
        .json({ success: false, msg: "This room is already full." });
    }
    // console.log(req.body);
    const newplayer = req.body.userId;
    if (room.playerList.indexOf(newplayer) !== -1) {
      return res
        .status(400)
        .json({ success: false, msg: "Player is already in the room." });
    }
    room.playerList.push({ user: newplayer, score: 0 });

    await room.save();

    res.status(200).json({ success: true, data: room.playerList });
  } catch (err) {
    console.log(err);
    res.status(400).json({ success: false, msg: "Something went wrong!!" });
  }
};

const quitRoom = async (req, res) => {
  const roomId = req.params.id;
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res
        .status(400)
        .json({ success: false, msg: "Cannot find the room." });
    }
    const leavingplayer = req.body.userId;
    // change to new schema
    const leavingplayerIndex = room.playerList.findIndex(
      (player) => player.user == leavingplayer
    );
    if (leavingplayerIndex === -1) {
      return res
        .status(400)
        .json({ success: false, msg: "Player is not in the room." });
    }

    room.playerList.splice(leavingplayerIndex, 1);
    await room.save();

    // When Leave Room, Send Updated Room Info
    const roomInfo = await Room.findById(roomId).populate([
      {
        path: "playerList.user",
        model: "User",
      },
      {
        path: "rounds.drawer",
        model: "User",
      },
      {
        path: "rounds.word",
        model: "Word",
      },
    ]);
    const response = {
      type: "status",
      data: roomInfo,
    };

    if (subscribers[roomId]) {
      broadcast(subscribers[roomId], response);
    }

    res
      .status(200)
      .json({ success: true, msg: "Leaving...", data: room.playerList });
  } catch (err) {
    console.log(err);
    res.status(400).json({ success: false, msg: "Something went wrong!!" });
  }
};

module.exports = {
  subscribeChat,
  postDraw,
  guessDraw,
  createRoom,
  getRoom,
  getRooms,
  updateRoom,
  deleteRoom,
  joinRoom,
  quitRoom,
};
