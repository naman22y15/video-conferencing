import { Server } from "socket.io"


let connections = {};
// connections:
// Stores which users (socket IDs) are in which room
// Structure:
// {
//    roomId1: [socketId1, socketId2, socketId3],
//    roomId2: [socketId4, socketId5]
// }
// -> Key = room name / room ID
// -> Value = array of socket IDs connected in that room


let messages = {};
// messages:
// Stores chat history for each room
// Structure:
// {
//    roomId1: [
//        { sender: "Alice", data: "Hello", "socket-id-sender": "abc123" },
//        { sender: "Bob", data: "Hi", "socket-id-sender": "xyz456" }
//    ],
//    roomId2: [
//        ...
//    ]
// }
// -> Key = room name
// -> Value = array of message objects for that room


let timeOnline = {};
// timeOnline:
// Stores the time when each user (socket) connected
// Structure:
// {
//    socketId1: Date_object,
//    socketId2: Date_object
// }
// -> Key = socket ID
// -> Value = timestamp (Date) when user came online
// Used to calculate how long a user stayed connected

export const connectToSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["*"],
            credentials: true
        }
    });


    io.on("connection", (socket) => {

        console.log("SOMETHING CONNECTED")

        socket.on("join-call", (path) => {

            if (connections[path] === undefined) {
                connections[path] = []
            }
            connections[path].push(socket.id)

            timeOnline[socket.id] = new Date();

            // connections[path].forEach(elem => {
            //     io.to(elem)
            // })

            for (let a = 0; a < connections[path].length; a++) {
                io.to(connections[path][a]).emit("user-joined", socket.id, connections[path])
            }

            if (messages[path] !== undefined) {
                for (let a = 0; a < messages[path].length; ++a) {
                    io.to(socket.id).emit("chat-message", messages[path][a]['data'],
                        messages[path][a]['sender'], messages[path][a]['socket-id-sender'])
                }
            }

        })

        socket.on("signal", (toId, message) => {
            io.to(toId).emit("signal", socket.id, message);
        })

        socket.on("chat-message", (data, sender) => {

            // sabse phle find the (meeting Id) jismei sender hai ; 
            let matchingRoom = '' ; 
            let found = false ; 

            for(let roomkey in connections){
                let roomValue = connections[roomKey] ; 
                if(!found&&roomValue.includes(socket.id)){
                    matchingRoom = roomKey ; 
                    found = true ; 
                    break; 
                }
            }

            if(found === true){
                if(messages[matchingRoom] === undefined){
                    messages[matchingRoom] = [] ; 
                }
                // uss room ke message mei data dall do 
                messages[matchingRoom].push({
                    'sender' : sender, 
                    "data" : data,
                    "socket-id-sender" : socket.id
                }) ; 

                // sabko notification bhej do 
                connections[matchingRoom].forEach((elem)=>{
                    io.to(elem).emit("chat-message", data, sender, socket.id) ; 
                }) ; 
                
            }

           

        })

socket.on("disconnect", () => {

    var diffTime = Math.abs(timeOnline[socket.id] - new Date());

    var key = null;

    // Loop through rooms
    for (let roomKey in connections) {
        let users = connections[roomKey];

        // Loop through users in that room
        for (let i = 0; i < users.length; i++) {

            if (users[i] === socket.id) {
                key = roomKey;

                // Notify all users in the room
                for (let j = 0; j < connections[key].length; j++) {
                    io.to(connections[key][j]).emit('user-left', socket.id);
                }

                // Remove user from room
                let index = connections[key].indexOf(socket.id);
                connections[key].splice(index, 1);

                // Delete room if empty
                if (connections[key].length === 0) {
                    delete connections[key];
                }

                break; // exit inner loop
            }
        }

        if (key !== null) break; // exit outer loop once found
    }

});


    return io;
}

