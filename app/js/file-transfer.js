'use strict';

/****************************************************************************
 * Initial setup
 ****************************************************************************/
let configuration = null;
let EventBus = require('vertx3-eventbus-client/vertx-eventbus');
let fs = require('fs');
let eb = new EventBus('http://localhost:11123/eventbus');
let roomURL = document.getElementById('url');

// Create a random room if not already present in the URL.
let isInitiator = false;
let room = window.location.hash.substring(1);
if (!room) {
    room = window.location.hash = randomToken();
}

/****************************************************************************
 * Signaling server
 ****************************************************************************/

eb.onopen = function () {
    console.log('Eventbus opened');
    // eb.registerHandler('ipaddr', function (error, ipaddr) {
    //     console.log(ipaddr);
    // });
    eb.registerHandler('created', function(error, clientId) {
        console.log('Created room', room, '- my client ID is', clientId);
        isInitiator = true;
    });
    eb.registerHandler('joined', function (error, clientId) {
        console.log('This peer has joined room', room, 'with client ID', clientId);
        if(!isInitiator) createPeerConnection(isInitiator, configuration);
    });
    eb.registerHandler('ready', function () {
        console.log('Socket is ready');
        createPeerConnection(isInitiator, configuration);
    });
    eb.registerHandler('message', function (error, message) {
        console.log('Client received message:', message);
        signalingMessageCallback(message.body);
    });
    eb.send('create or join', room);
    // eb.send('ipaddr', 'ipaddr');
};

/**
 * Send message to signaling server
 */
function sendMessage(message) {
    console.log('Client sending message: ', message);
    eb.publish('message', message);
}

//Updates URL on the page so that users can copy&paste it to their peers.

function updateRoomURL(ipaddr) {
    let url;
    if (!ipaddr) {
        url = location.href;
    } else {
        url = location.protocol + '//' + ipaddr + ':2013/#' + room;
    }
}

/****************************************************************************
 * WebRTC peer connection and data channel
 ****************************************************************************/

let peerConn;
let dataChannel;

function signalingMessageCallback(message) {
    if (message.type === 'offer') {
        console.log('Got offer. Sending answer to peer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            },
            logError);
        peerConn.createAnswer(onLocalSessionCreated, logError);

    } else if (message.type === 'answer') {
        console.log('Got answer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            },
            logError);

    } else if (message.type === 'candidate') {
        peerConn.addIceCandidate(new RTCIceCandidate({
            candidate: message.candidate
        }));

    } else if (message === 'bye') {
        // TODO: cleanup RTC connection?
    }
}

function createPeerConnection(isInitiator, config) {
    console.log('Creating Peer connection as initiator?', isInitiator, 'config:',
        config);
    peerConn = new RTCPeerConnection(config);

    // send any ice candidates to the other peer
    peerConn.onicecandidate = function (event) {
        console.log('icecandidate event:', event);
        if (event.candidate) {
            sendMessage({
                type: 'candidate',
                label: event.candidate.sdpMLineIndex,
                id: event.candidate.sdpMid,
                candidate: event.candidate.candidate
            });
        } else {
            console.log('End of candidates.');
        }
    };

    if (isInitiator) {
        console.log('Creating Data Channel');
        dataChannel = peerConn.createDataChannel('photos');
        onDataChannelCreated(dataChannel);

        console.log('Creating an offer');
        peerConn.createOffer(onLocalSessionCreated, logError);
    } else {
        peerConn.ondatachannel = function (event) {
            console.log('ondatachannel:', event.channel);
            dataChannel = event.channel;
            onDataChannelCreated(dataChannel);
        };
    }
}

function onLocalSessionCreated(desc) {
    console.log('local session created:', desc);
    peerConn.setLocalDescription(desc, function () {
        console.log('sending local desc:', peerConn.localDescription);
        sendMessage(peerConn.localDescription);
    }, logError);
}

function onDataChannelCreated(channel) {
    console.log('onDataChannelCreated:', channel);

    channel.onopen = function () {
        console.log('CHANNEL opened!!!');
    };

    channel.onmessage = (adapter.browserDetails.browser === 'firefox') ?
        receiveDataFirefoxFactory() : receiveDataChromeFactory();
}

let receivedBuffer = [];
let downloadAnchor = document.querySelector('a#download');

function receiveDataChromeFactory() {
    let buf, count;

    return function onmessage(event) {
        if (typeof event.data === 'string') {
            buf = window.buf = new Uint8ClampedArray(parseInt(event.data));
            count = 0;
            console.log('Expecting a total of ' + buf.byteLength + ' bytes');
            return;
        }
        receivedBuffer.push(event.data);

        let data = new Uint8ClampedArray(event.data);
        buf.set(data, count);

        count += data.byteLength;
        console.log('count: ' + count);

        if (count === buf.byteLength) {
            // we're done: all data chunks have been received
            let received = new window.Blob(receivedBuffer);
            saveBlobToFile(received);
            receivedBuffer = [];
            downloadAnchor.href = URL.createObjectURL(received);
            downloadAnchor.download = 'file';
            downloadAnchor.textContent =
                'Click to download ' + 'file';
            downloadAnchor.style.display = 'block';
        }
    };
}

function receiveDataFirefoxFactory() {
    var count, total, parts;

    return function onmessage(event) {
        if (typeof event.data === 'string') {
            total = parseInt(event.data);
            parts = [];
            count = 0;
            console.log('Expecting a total of ' + total + ' bytes');
            return;
        }

        parts.push(event.data);
        count += event.data.size;
        console.log('Got ' + event.data.size + ' byte(s), ' + (total - count) +
            ' to go.');

        if (count === total) {
            console.log('Assembling payload');
            var buf = new Uint8ClampedArray(total);
            var compose = function (i, pos) {
                var reader = new FileReader();
                reader.onload = function () {
                    buf.set(new Uint8ClampedArray(this.result), pos);
                    if (i + 1 === parts.length) {
                        console.log('Done. Rendering photo.');
                    } else {
                        compose(i + 1, pos + this.result.byteLength);
                    }
                };
                reader.readAsArrayBuffer(parts[i]);
            };
            compose(0, 0);
        }
    };
}


/****************************************************************************
 * Aux functions, mostly UI-related
 ****************************************************************************/

function randomToken() {
    return Math.floor((1 + Math.random()) * 1e16).toString(16).substring(1);
}

function logError(err) {
    console.log(err.toString(), err);
}

let data;

function sendFile() {
    let file = document.getElementById('file').files[0];
    let CHUNK_LEN = 16384;

    let fr = new FileReader();
    fr.onload = function () {
        data = fr.result;
        console.log(data);
        let len = data.byteLength, n = len / CHUNK_LEN | 0;
        console.log('Sending a total of ' + len + ' byte(s)');
        dataChannel.send(len);
        let sliceFile = function (offset) {
            let reader = new window.FileReader();
            reader.onload = (function () {
                return function (e) {
                    console.log("Sending...");
                    dataChannel.send(e.target.result);
                    if (file.size > offset + e.target.result.byteLength) {
                        window.setTimeout(sliceFile, 0, offset + CHUNK_LEN);
                    }
                    //sendProgress.value = offset + e.target.result.byteLength;
                };
            })(file);
            let slice = file.slice(offset, offset + CHUNK_LEN);
            reader.readAsArrayBuffer(slice);
        };
        sliceFile(0);
    };
    fr.readAsArrayBuffer(file);
}

function saveBlobToFile(blob) {
    let reader = new FileReader();
    reader.onload = function(){
        let buffer = new Buffer(reader.result);
        fs.writeFile('temp', buffer, {}, (err, res) => {
            if(err){
                console.error(err);
                return
            }
            console.log('file saved')
        })
    };
    reader.readAsArrayBuffer(blob)
}