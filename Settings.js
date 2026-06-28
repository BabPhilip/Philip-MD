module.exports = {
    ownerName: "Philip Babs",
    ownerNumber: "2348165190329", // no + or spaces

    prefix: ".",
    botName: "Philip Bot",

    autoPair: true,

    // Group controls - toggle on/off
    groupFeatures: {
        welcome: true,
        goodbye: true,
        antilink: true,
        antibadword: true,
        antistatus: false,
        antitagall: true,
        antidelete: false
    },

    // Personal controls
    autoViewStatus: true,
    autoReact: true,
    autoRead: true,
    autoTyping: true,
    antiCall: false,

    reactEmoji: "❤️",

    badWords: ["fuck", "bitch", "nigga", "bastard"],

    messages: {
        welcome: "Welcome @user to @group! Read group rules.",
        goodbye: "Goodbye @user. We'll miss you!",
        kick: "@user was removed by admin",
        promote: "@user is now admin",
        demote: "@user is no longer admin",
        warn: "@user warned. Warns: @warns/3. Next = kick",
        mute: "Group muted. Only admins can send messages",
        unmute: "Group unmuted. Everyone can chat",
        notAdmin: "You must be group admin",
        notOwner: "Only bot owner can use this"
    }
}
