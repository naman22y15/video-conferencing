import React, { useEffect, useRef, useState } from 'react'  // react hooks use kr rhe hai
import io from "socket.io-client"; // socket connection ke liye
import { Badge, IconButton, TextField } from '@mui/material'; // UI components
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam'; // camera on icon
import VideocamOffIcon from '@mui/icons-material/VideocamOff' // camera off icon
import styles from "../styles/videoComponent.module.css"; // css file
import CallEndIcon from '@mui/icons-material/CallEnd' // call end icon
import MicIcon from '@mui/icons-material/Mic' // mic on
import MicOffIcon from '@mui/icons-material/MicOff' // mic off
import ScreenShareIcon from '@mui/icons-material/ScreenShare'; // screen share icon
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare' // stop share icon
import ChatIcon from '@mui/icons-material/Chat' // chat icon
import server from '../environment'; // backend server url

const server_url = server; // server ko constant me store kr liya

var connections = {}; // yaha sab peer connections store honge

// ICE server config (WebRTC ke liye)
const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" } // stun server for NAT traversal
    ]
}

export default function VideoMeetComponent() {

    var socketRef = useRef(); // socket instance store krne ke liye
    let socketIdRef = useRef(); // apna socket id store krne ke liye

    let localVideoref = useRef(); // local video DOM reference

    let [videoAvailable, setVideoAvailable] = useState(true); // camera available hai ya nahi
    let [audioAvailable, setAudioAvailable] = useState(true); // mic available hai ya nahi

    let [video, setVideo] = useState([]); // video on/off state
    let [audio, setAudio] = useState(); // audio on/off state
    let [screen, setScreen] = useState(); // screen share state

    let [showModal, setModal] = useState(true); // chat open hai ya nahi
    let [screenAvailable, setScreenAvailable] = useState(); // screen share supported hai ya nahi

    let [messages, setMessages] = useState([]) // chat messages
    let [message, setMessage] = useState(""); // current message

    let [newMessages, setNewMessages] = useState(3); // unread messages count

    let [askForUsername, setAskForUsername] = useState(true); // lobby screen control
    let [username, setUsername] = useState(""); // user name

    const videoRef = useRef([]) // sab remote video references
    let [videos, setVideos] = useState([]) // sab users ke streams store honge

    useEffect(() => {
        console.log("HELLO") // mount hote hi run hoga
        getPermissions(); // permissions check kr lo
    })

    // screen share function
    let getDislayMedia = () => {
        if (screen) { // agar screen true hai tabhi chalao
            if (navigator.mediaDevices.getDisplayMedia) {
                navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                    .then(getDislayMediaSuccess) // success pe call
                    .catch((e) => console.log(e))
            }
        }
    }

    // camera + mic permission lena
    const getPermissions = async () => {
        try {
            const videoPermission = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoPermission) {
                setVideoAvailable(true); // video allowed
            } else {
                setVideoAvailable(false); // video denied
            }

            const audioPermission = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (audioPermission) {
                setAudioAvailable(true); // mic allowed
            } else {
                setAudioAvailable(false); // mic denied
            }

            // screen share supported hai ya nahi
            if (navigator.mediaDevices.getDisplayMedia) {
                setScreenAvailable(true);
            } else {
                setScreenAvailable(false);
            }

            // agar video ya audio available hai
            if (videoAvailable || audioAvailable) {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({ video: videoAvailable, audio: audioAvailable });

                if (userMediaStream) {
                    window.localStream = userMediaStream; // global stream store
                    if (localVideoref.current) {
                        localVideoref.current.srcObject = userMediaStream; // local video show
                    }
                }
            }
        } catch (error) {
            console.log(error);
        }
    };

    // jab video/audio state change ho
    useEffect(() => {
        if (video !== undefined && audio !== undefined) {
            getUserMedia(); // media dubara lo
        }
    }, [video, audio])

    // initial media + socket connect
    let getMedia = () => {
        setVideo(videoAvailable); // set video state
        setAudio(audioAvailable); // set audio state
        connectToSocketServer(); // socket connect
    }

    // jab media mil jata hai
    let getUserMediaSuccess = (stream) => {

        try {
            window.localStream.getTracks().forEach(track => track.stop()) // purana stream band
        } catch (e) {}

        window.localStream = stream // naya stream store
        localVideoref.current.srcObject = stream // local video update

        // sab peers ko naya stream bhejo
        for (let id in connections) {

            if (id === socketIdRef.current) continue // khud ko skip

            connections[id].addStream(window.localStream)

            // offer create karo
            connections[id].createOffer().then((description) => {

                connections[id].setLocalDescription(description)
                    .then(() => {
                        // server ko SDP bhejo
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
            })
        }

        // jab stream band ho jaye (camera off etc.)
        stream.getTracks().forEach(track => track.onended = () => {

            setVideo(false);
            setAudio(false);

            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) {}

            // fake stream bhejo (black + silence)
            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            localVideoref.current.srcObject = window.localStream

            // sabko update bhejo
            for (let id in connections) {
                connections[id].addStream(window.localStream)

                connections[id].createOffer().then((description) => {
                    connections[id].setLocalDescription(description)
                        .then(() => {
                            socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                        })
                })
            }
        })
    }

    // user media lena
    let getUserMedia = () => {
        if ((video && videoAvailable) || (audio && audioAvailable)) {

            navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
                .then(getUserMediaSuccess)
                .catch((e) => console.log(e))

        } else {
            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) {}
        }
    }

    // server se message aane par
    let gotMessageFromServer = (fromId, message) => {

        var signal = JSON.parse(message)

        if (fromId !== socketIdRef.current) {

            if (signal.sdp) {
                connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp))
                    .then(() => {

                        // agar offer hai to answer bhejo
                        if (signal.sdp.type === 'offer') {
                            connections[fromId].createAnswer().then((description) => {
                                connections[fromId].setLocalDescription(description).then(() => {
                                    socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }))
                                })
                            })
                        }
                    })
            }

            if (signal.ice) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice))
            }
        }
    }

    // socket connection setup
    let connectToSocketServer = () => {

        socketRef.current = io.connect(server_url, { secure: false }) // connect

        socketRef.current.on('signal', gotMessageFromServer) // signaling listen

        socketRef.current.on('connect', () => {

            socketRef.current.emit('join-call', window.location.href) // room join

            socketIdRef.current = socketRef.current.id // apni id store

            socketRef.current.on('chat-message', addMessage) // chat listen

            socketRef.current.on('user-left', (id) => {
                // jo user gaya uska video hatao
                setVideos((videos) =>
                    videos.filter((video) => video.socketId !== id)
                )
            })

            socketRef.current.on('user-joined', (id, clients) => {

                clients.forEach((socketListId) => {

                    // new peer connection
                    connections[socketListId] = new RTCPeerConnection(peerConfigConnections)

                    // ICE candidate send karo
                    connections[socketListId].onicecandidate = function (event) {
                        if (event.candidate != null) {
                            socketRef.current.emit(
                                'signal',
                                socketListId,
                                JSON.stringify({ 'ice': event.candidate })
                            )
                        }
                    }

                    // jab remote stream aaye
                    connections[socketListId].onaddstream = (event) => {

                        let videoExists = videoRef.current.find(
                            video => video.socketId === socketListId
                        );

                        if (videoExists) {
                            // update existing
                            setVideos(videos => {
                                const updatedVideos = videos.map(video =>
                                    video.socketId === socketListId
                                        ? { ...video, stream: event.stream }
                                        : video
                                );
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });

                        } else {
                            // new video add
                            let newVideo = {
                                socketId: socketListId,
                                stream: event.stream,
                                autoplay: true,
                                playsinline: true
                            };

                            setVideos(videos => {
                                const updatedVideos = [...videos, newVideo];
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        }
                    };

                    // local stream add karo
                    if (window.localStream) {
                        connections[socketListId].addStream(window.localStream)
                    }
                })

                // agar current user hi join hua hai
                if (id === socketIdRef.current) {

                    for (let id2 in connections) {

                        if (id2 === socketIdRef.current) continue

                        connections[id2].addStream(window.localStream)

                        connections[id2].createOffer().then((description) => {

                            connections[id2].setLocalDescription(description)
                                .then(() => {

                                    socketRef.current.emit(
                                        'signal',
                                        id2,
                                        JSON.stringify({
                                            'sdp': connections[id2].localDescription
                                        })
                                    )
                                })
                        })
                    }
                }
            })
        })
    }

    // silent audio create krna
    let silence = () => {
        let ctx = new AudioContext()
        let oscillator = ctx.createOscillator()
        let dst = oscillator.connect(ctx.createMediaStreamDestination())
        oscillator.start()
        ctx.resume()
        return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false })
    }

    // black video create krna
    let black = ({ width = 640, height = 480 } = {}) => {
        let canvas = Object.assign(document.createElement("canvas"), { width, height })
        canvas.getContext('2d').fillRect(0, 0, width, height)
        let stream = canvas.captureStream()
        return Object.assign(stream.getVideoTracks()[0], { enabled: false })
    }

    // video toggle
    let handleVideo = () => {
        setVideo(!video);
    }

    // audio toggle
    let handleAudio = () => {
        setAudio(!audio)
    }

    // screen change hone par
    useEffect(() => {
        if (screen !== undefined) {
            getDislayMedia();
        }
    }, [screen])

    let handleScreen = () => {
        setScreen(!screen);
    }

    // call end
    let handleEndCall = () => {
        try {
            let tracks = localVideoref.current.srcObject.getTracks()
            tracks.forEach(track => track.stop())
        } catch (e) {}
        window.location.href = "/"
    }

    // chat open
    let openChat = () => {
        setModal(true);
        setNewMessages(0);
    }

    // message change
    let handleMessage = (e) => {
        setMessage(e.target.value);
    }

    // message add
    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
    };

    // send message
    let sendMessage = () => {
        socketRef.current.emit('chat-message', message, username)
        setMessage("");
    }

    // connect button
    let connect = () => {
        setAskForUsername(false); // lobby se bahar
        getMedia(); // media start
    }

    return (
        <div>

            {askForUsername === true ?

                <div>


                    <h2>Enter into Lobby </h2>
                    <TextField id="outlined-basic" label="Username" value={username} onChange={e => setUsername(e.target.value)} variant="outlined" />
                    <Button variant="contained" onClick={connect}>Connect</Button>


                    <div>
                        <video ref={localVideoref} autoPlay muted></video>
                    </div>

                </div> :


                <div className={styles.meetVideoContainer}>

                    {showModal ? <div className={styles.chatRoom}> // show chat panel if it is on 

                        <div className={styles.chatContainer}>
                            <h1>Chat</h1>

                            <div className={styles.chattingDisplay}>

                                {messages.length !== 0 ? messages.map((item, index) => {

                                    console.log(messages)
                                    return (
                                        <div style={{ marginBottom: "20px" }} key={index}>
                                            <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                            <p>{item.data}</p>
                                        </div>
                                    )
                                }) : <p>No Messages Yet</p>}


                            </div>

                            <div className={styles.chattingArea}>
                                <TextField value={message} onChange={(e) => setMessage(e.target.value)} id="outlined-basic" label="Enter Your chat" variant="outlined" />
                                <Button variant='contained' onClick={sendMessage}>Send</Button>
                            </div>


                        </div>
                    </div> : <></>}


                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }}>
                            {(video === true) ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleEndCall} style={{ color: "red" }}>
                            <CallEndIcon  />
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: "white" }}>
                            {audio === true ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>

                        {screenAvailable === true ?
                            <IconButton onClick={handleScreen} style={{ color: "white" }}>
                                {screen === true ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton> : <></>}

                        <Badge badgeContent={newMessages} max={999} color='orange'>
                            <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                                <ChatIcon />                        </IconButton>
                        </Badge>

                    </div>


                    <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted></video>

                    <div className={styles.conferenceView}>
                        // here video is array of pair wjhe pair first elemetn is socidid and second elemetn is stream [{socketId, ,stream}, {socketId, stream}]
                        {videos.map((video) => (  


                    
                            <div key={video.socketId}> // for each person create a box 
                                <video

                                    data-socket={video.socketId}  // to store whom does this video belongs to 
                                    ref={ref => {  // ref gives access to real video dom 
                                        if (ref && video.stream) {  // like if video element exist and stream exists 
                                            ref.srcObject = video.stream;  // if exists play this persons video 
                                        }
                                    }}
                                    autoPlay // start playing imediatley without user clicking play 
                                >
                                </video>
                            </div>

                        ))}

                    </div>

                </div>

            }

        </div>
    )
}
