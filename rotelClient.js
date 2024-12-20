// Original RotelClient for Rotel RA-12 amplifier by Claes Holmerson
// Translation for Rotel A12 / A14 amplifier protocol by Samuel Kost

var RotelClient = function() {

	var config = RotelConfig || {  //Adjust custom config in rotelConfig.js
		websocketUrl : 'ws://localhost:8989/ws',
		serialPortDevice: '/dev/ttyUSB0',
		aux1: 'AUX1',
		aux2: 'AUX2',
		coax1: 'COAX1',
		coax2: 'COAX2',
		opt1: 'OPT1',
		opt2: 'OPT2',
		tuner: 'TUNER',
		phono: 'PHONO',
		cd: 'CD',
		usb: 'USB',
		bluetooth: 'BLUETOOTH',
		pcusb: 'PCUSB'
	};

	var self = this;

	this.sources = {		
		aux1: 'AUX1',
		aux2: 'AUX2',
		coax1: 'COAX1',
		coax2: 'COAX2',
		opt1: 'OPT1',
		opt2: 'OPT2',
		tuner: 'TUNER',
		phono: 'PHONO',
		cd: 'CD',
		usb: 'USB',
		bluetooth: 'BLUETOOTH',
		pcusb: 'PCUSB' 
	}

	this.volume = null;
	this.power = null;
	this.mute = null;
	this.inputSource = null;
	this.tone = null;
	this.bass = null;
	this.treble = null;
	this.balance = null;
	this.freq = null;
	this.display1 = null;
	this.display2 = null;
	// A12/A14 To-Do: speaker A / B
	
	this.stateChanged = function() {
		console.log(	"volume: " + this.volume + 
				", power: " + this.power + 
				", mute: " + this.mute + 
				", inputSource: " + this.inputSource + 
				", tone: " + this.tone + 
				", bass: " + this.bass + 
				", treble: " + this.treble + 
				", balance: " + this.balance +
				", freq: " + this.freq + 
				", display1: '" + this.display1 + "'" +  
				", display2: '" + this.display2  + "'" )

		this.detachEventHandlers();		
		$("#power-flipswitch").val(this.power).flipswitch('refresh');
		if ("on" == $("#power-flipswitch").val()) {
			$("#tone-flipswitch").flipswitch('enable');
			$("#mute-flipswitch").flipswitch('enable');
			$("#volume-slider").slider("enable");
			$("#balance-slider").slider("enable");
			$("#source").selectmenu('enable');
			if ("off" == $("#tone-flipswitch").val()) {
				$("#bass-slider").slider("enable");
				$("#treble-slider").slider("enable");
			} else {
				$("#bass-slider").slider("disable");
				$("#treble-slider").slider("disable");
			}
		} else { // disable all controls but power flipswitch if power=standby
			$("#tone-flipswitch").flipswitch('disable');
			$("#mute-flipswitch").flipswitch('disable');
			$("#volume-slider").slider("disable");
			$("#balance-slider").slider("disable");
			$("#source").selectmenu('disable');
			$("#bass-slider").slider("disable");
			$("#treble-slider").slider("disable");
		}			
		$("#mute-flipswitch").val(this.mute).flipswitch('refresh');
		$("#tone-flipswitch").val(this.tone).flipswitch('refresh');
		$("#volume-slider").val(this.volume).slider('refresh');
		$("#source").val(this.inputSource).selectmenu('refresh');	

		$("#bass-slider").val(Number(this.bass)).slider('refresh');
		$("#treble-slider").val(Number(this.treble)).slider('refresh');
		if (this.balance != null) {
			$("#balance-slider").val(Number(this.balance.replace('L', '-').replace('R', ''))).slider('refresh');
		}
		// A12 display (A12/A14 protocol does not include display status, thus we have to build it ourselves)
		switch	(this.power) {
			case "standby":
				this.display1 = " ";
				this.display2 = " ";
				break;
			case "on":
				if (typeof this.inputSource == "string") {
					var inpSrc = this.inputSource.toUpperCase();
					if (inpSrc === "PCUSB") {
						inpSrc = "PC-USB";
					}
				}
				var vol = this.volume;
				if (this.mute === "on") {
					vol = "--";
				}
				this.display1 = inpSrc + "\t" + vol;
				switch (this.freq) {
					default:
						this.display2 = "FREQ: " + this.freq + "Hz";
						break;
					case null: // fallthrough
					case "off":
						switch (this.tone) {
							case "off":
								var bass = parseInt(this.bass);
								if (bass > 0) {
									bass = "+" + bass;
								}
								var treb = parseInt(this.treble);
								if (treb > 0) {
									treb = "+" + treb;
								}
								this.display2 = "BASS " + bass + "  TREB " + treb;
								break;
							default:
								this.display2 = "TONE BYPASS";
						}
						break;
				}
		}

		$("#lcd-display").text(this.display1 + "\n" + this.display2);
		if (this.inputSource != null && this.volume != null) {
			document.title = (config[this.inputSource] != null ? config[this.inputSource] : this.inputSource) + 
				", Volume: " + this.volume;
		}
		this.attachEventHandlers();
	}

	// A12 default is manual feedback. Automatic feedback is needed for RotelWebClient to work
	this.setFeedbackOn = function () {
		self.webSocket.send(self.FeedbackOnEvent());
	}

	// Responses from A12 usually arrive in multiple parts (WS messages) and sometimes they arrive in a mixed up order (at least in my setup)
	// Sending many commands in a very short time aggravates the problem. Thus, when initializing RotelState, we wait for the response to
	// complete and retry initialization of each property until the response is meaningful.
	var gotResponse = function() {
		return new Promise(resolve => {
			this.addEventListener('responded', resolve);
		});
	}

	var sleep = function(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	this.initializeRotelState = async function() {
		var p=0, i=0, to=0, m=0, v=0, f=0, b=0, tr=0, bl=0;
		while (this.power != 'on' && this.power != 'standby') {
			self.webSocket.send(self.getCurrentPowerEvent());
			await gotResponse();
			console.log("got response (power)"+p);
			p+=1;	
		}
		// Asking A12 for the current state of volume, source, tone, etc. when it is in standby tends to wake it up (power on)
		// Thus, we don't ask all the rest, when power=standby, but reinitialize once we turn power on by flipping the switch.
		if (this.power == 'on') {
			while (!(this.inputSource in this.sources)) {
				self.webSocket.send(self.getCurrentSourceEvent());
				await gotResponse();
				console.log("got response (source)"+i);
				i+=1;	
			}
			while (this.tone != 'on' && this.tone != 'off') {
				self.webSocket.send(self.getToneEvent());
				await gotResponse();
				console.log("got response (tone)"+to);
				to+=1;	
			}
			while (this.mute != 'on' && this.mute != 'off') {
				self.webSocket.send(self.getMuteEvent());
				await gotResponse();
				console.log("got response (mute)"+m);
				m+=1;	
			}
			while (this.volume == null) {
				self.webSocket.send(self.getVolumeEvent());
				await gotResponse();
				console.log("got response (vol)"+v);
				v+=1;	
			}
			while (this.freq == null) {
				self.webSocket.send(self.getCurrentFreqEvent());
				await gotResponse();
				console.log("got response (freq)"+v);
				f+=1;	
			}
			while (this.bass == null) {
				self.webSocket.send(self.getBassEvent());
				await gotResponse();
				console.log("got response (bass)"+b);
				b+=1;	
			}
			while (this.treble == null) {
				self.webSocket.send(self.getTrebleEvent());
				await gotResponse();
				console.log("got response (treble)"+tr);
				tr+=1;
			}
			while (this.balance == null) {
				self.webSocket.send(self.getBalanceEvent());
				await gotResponse();
				console.log("got response (balance)"+bl);
				bl+=1;
			}
		}
		config.aux1 ? $("#aux1").text(config.aux1) : $("#aux1").attr("disabled","disabled");
		config.aux2 ? $("#aux2").text(config.aux2) : $("#aux2").attr("disabled","disabled");
		config.coax1 ? $("#coax1").text(config.coax1) : $("#coax1").attr("disabled","disabled");
		config.coax2 ? $("#coax2").text(config.coax2) : $("#coax2").attr("disabled","disabled");
		config.opt1 ? $("#opt1").text(config.opt1) : $("#opt1").attr("disabled","disabled");
		config.opt2 ? $("#opt2").text(config.opt2) : $("#opt2").attr("disabled","disabled");
		config.tuner ? $("#tuner").text(tuner.coax1) : $("#tuner").attr("disabled","disabled");
		config.phono ? $("#phono").text(config.phono) : $("#phono").attr("disabled","disabled");
		config.cd ? $("#cd").text(config.cd) : $("#cd").attr("disabled","disabled");
		config.usb ? $("#usb").text(config.usb) : $("#usb").attr("disabled","disabled");
		config.bluetooth ? $("#bluetooth").text(config.bluetooth) : $("#bluetooth").attr("disabled","disabled");
		config.pcusb ? $("#pcusb").text(config.pcusb) : $("#pcusb").attr("disabled","disabled");
	
		console.log("Waiting cycles: power"+p+" source"+i+" tone"+to+" mute"+m+" vol"+v+" freq"+f+" bass"+b+" treble"+tr+" balance"+bl)
	}

	this.detachEventHandlers = function() {
	    	$("#source").unbind("change");
	    	$("#mute-flipswitch").unbind("change");
	    	$("#power-flipswitch").unbind("change");
	    	$("#tone-flipswitch").unbind("change");
	    	$("#volume-slider").unbind("change");
	    	$("#bass-slider").unbind("change");
	    	$("#treble-slider").unbind("change");
	    	$("#balance-slider").unbind("change");
	}

	this.attachEventHandlers = function() {
	    	$("#source").on("change", function() {
			var a = self.sourceSetEvent($("#source").val());
			self.webSocket.send(a);
		} );

	    	$("#mute-flipswitch").on("change", function() {
			var a = self.muteSetEvent($("#mute-flipswitch").val());
			self.webSocket.send(a);
		} );

	    	$("#power-flipswitch").on("change", async function() {
			var c = $("#power-flipswitch").val();
			if (c == "standby") {
				c = "off";
			}
			var a = self.powerSetEvent(c);
			self.webSocket.send(a);
			// Reinitialize RotelState when turning A12 on
			if (c === "on") {
				// Reset volume to get in reinitialized after power on
				// In order to get the actual volume after power on (A12 max power on volume setting)
				self.volume = null;
				await gotResponse();
				console.log("got response (power on)");
				self.initializeRotelState();
			}
		} );

	    	$("#tone-flipswitch").on("change", function() {
			var a = self.toneSetEvent($("#tone-flipswitch").val());
			self.webSocket.send(a);
		} );

	    	$("#volume-slider").on("change", function() {
			var a = self.volumeSetEvent($("#volume-slider").val());
			self.webSocket.send(a);
		} );

	    	$("#bass-slider").on("change", function() {
			var v = $("#bass-slider").val();
			var a = null;
			if (v < 0) {
				a = self.bassSetEvent('-' + ('0' + Math.abs(v)).slice(-2));
			} else if (v == 0) {
				a = self.bassSetEvent('000');
			} else if (v > 0) {
				a = self.bassSetEvent('+' + ('0' + Math.abs(v)).slice(-2));
			}
			self.webSocket.send(a);
		} );

	    	$("#treble-slider").on("change", function() {
			var v = $("#treble-slider").val();
			var a = null;
			if (v < 0) {
				a = self.trebleSetEvent('-' + ('0' + Math.abs(v)).slice(-2));
			} else if (v == 0) {
				a = self.trebleSetEvent('000');
			} else if (v > 0) {
				a = self.trebleSetEvent('+' + ('0' + Math.abs(v)).slice(-2));
			}
			self.webSocket.send(a);
		} );

	    	$("#balance-slider").on("change", function() {
			var v = $("#balance-slider").val();
			var a = null;
			if (v < 0) {
				a = self.balanceSetEvent('l' + ('0' + Math.abs(v)).slice(-2));
			} else if (v == 0) {
				a = self.balanceSetEvent('000');
			} else if (v > 0) {
				a = self.balanceSetEvent('r' + ('0' + Math.abs(v)).slice(-2));
			}
			self.webSocket.send(a);
		} );

	}

	this.webSocket = new ReconnectingWebSocket(config.websocketUrl);
	this.webSocket.timeoutInterval = 1000;
	this.webSocket.maxReconnectInterval = 8000;
	this.webSocket.onopen = async function() {
		self.webSocket.send('open '+config.serialPortDevice+' 115200');
		self.setFeedbackOn();
		// here we just want to wait a little to minimize the risk of mixing up responses
		// we cannot wait for the response as there won't be any if power=standby
		await sleep(25); console.log("waited"); 
		self.initializeRotelState();
	};

	this.webSocket.onerror = function(error) {
		console.log("error: " + error);	
	};

	this.webSocket.onmessage = function(e) {
		parseEvent(e);
	};

	this.sourceCdEvent =  function() { return this.createActionEvent('cd!'); }
	this.sourceUsbEvent =  function() { return this.createActionEvent('usb!'); }
	this.sourceBluetoothEvent =  function() { return this.createActionEvent('bluetooth!'); }
	this.sourcePCUsbEvent =  function() { return this.createActionEvent('pcusb!'); }
	this.sourceCoax1Event =  function() { return this.createActionEvent('coax1!'); }
	this.sourceCoax2Event =  function() { return this.createActionEvent('coax2!'); }
	this.sourceOpt1Event =  function() { return this.createActionEvent('opt1!'); }
	this.sourceOpt2Event =  function() { return this.createActionEvent('opt2!'); }
	this.sourceAux1Event =  function() { return this.createActionEvent('aux1!'); }
	this.sourceAux2Event =  function() { return this.createActionEvent('aux2!'); }
	this.sourceTunerEvent =  function() { return this.createActionEvent('tuner!'); }
	this.sourcePhonoEvent =  function() { return this.createActionEvent('phono!'); }

	this.sourceSetEvent = function(v) { return this.createActionEvent(v + '!'); }

	this.toggleMuteEvent = function() { return this.createActionEvent('mute!'); }
	this.muteOnEvent = function() { return this.createActionEvent('mute_on!'); }
	this.muteOffEvent = function() { return this.createActionEvent('mute_off!'); }
	this.muteSetEvent = function(v) { return this.createActionEvent('mute_' + v + '!'); }
	this.toneOnEvent = function() { return this.createActionEvent('bypass_on!'); } 
	this.toneOffEvent = function() { return this.createActionEvent('bypass_off!'); }
	this.toneSetEvent = function(v) { return this.createActionEvent('bypass_' + v + '!'); }
	this.togglePowerEvent = function() { return this.createActionEvent('power_toggle!'); }
	this.powerOnEvent = function() { return this.createActionEvent('power_on!'); }
	this.powerOffEvent = function() { return this.createActionEvent('power_off!'); }
	this.powerSetEvent = function(v) { return this.createActionEvent('power_' + v + '!'); }
	this.volumeSetEvent = function(v) { return this.createActionEvent('vol_' + v + '!'); }

	this.bassSetEvent = function(v) { return this.createActionEvent('bass_' + v + '!'); }
	this.bassUpEvent = function() { return this.createActionEvent('bass_up!'); }
	this.bassDownEvent = function() { return this.createActionEvent('bass_down!'); }

	this.trebleSetEvent = function(v) { return this.createActionEvent('treble_' + v + '!'); }
	this.trebleUpEvent = function() { return this.createActionEvent('treble_up!'); }
	this.trebleDownEvent = function() { return this.createActionEvent('treble_down!'); }

	this.balanceSetEvent = function(v) { return this.createActionEvent('balance_' + v + '!'); }
	this.balanceLeftEvent = function() { return this.createActionEvent('balance_left!'); }
	this.balanceRightEvent = function() { return this.createActionEvent('balance_right!'); }

	this.volumeDownEvent = function() { return this.createActionEvent('vol_down!'); }
	this.volumeUpEvent = function() { return this.createActionEvent('vol_up!'); }
	this.getCurrentPowerEvent = function() { return this.createActionEvent('power?'); }
	this.getCurrentSourceEvent = function() { return this.createActionEvent('source?'); }
	this.getToneEvent = function() { return this.createActionEvent('bypass?'); }
	this.getBassEvent = function() { return this.createActionEvent('bass?'); }
	this.getTrebleEvent = function() { return this.createActionEvent('treble?'); }
	this.getBalanceEvent = function() { return this.createActionEvent('balance?'); }
	this.getCurrentFreqEvent = function() { return this.createActionEvent('freq?'); }
	this.getVolumeEvent = function() { return this.createActionEvent('volume?'); }
	this.getMuteEvent = function() { return this.createActionEvent('mute?'); }
	
	this.FeedbackOnEvent = function() { return this.createActionEvent('rs232_update_on!'); }

	this.createActionEvent = function(action) {
		return 'sendjson {"P":"'+config.serialPortDevice+'","Data":[{"D":"'+action+'"}]}';
	};

	// create buffer-variable, which collects all messages from server (A12) until receiving terminating character ('$')
	var buffer = ""

	var parseEvent = function(evt) {
		console.log("server: " + evt.data);
		if (typeof evt.data == "string") {
			var data = null;
			try {
				data = JSON.parse(evt.data);
			} catch (err) {
				console.log("Could not parse as JSON:" + JSON.stringify(evt));
			}
			console.log("data:" + data);
			if (data && data.D) {
				buffer = buffer.concat(data.D);
				buffer = buffer.replace(/undefined/g, "");
				console.log("buffer:" + buffer);
				// A12 responses end with $; wait for complete response(s) in case it gets split in several events
				if (buffer.endsWith("$")) {
					buffer = buffer.replace("pc_usb","pcusb") // A12 response for source PC-USB is "pc_usb$" while command is "pcusb!"
					var responses = buffer.split("$");
					if (responses) {
						for (var i = 0; i < responses.length; i++)  {
							console.log("responses[" + i + "]: "  + responses[i]);
							response = responses[i];
							console.log("response: " + response);
							
							typeAndValue = response.split("=");
							console.log("typeAndValue: " + typeAndValue);
							if (typeAndValue) {
								var type = typeAndValue[0];
								var value = typeAndValue[1];
							}
				
							console.log("type: '" + type+"', value: '"+value+"'");
							if (type != null && value != null) {
								if (value) {
									switch (type) {
										case "volume":
											self.volume = value;
											break;
										case "power":
											self.power = value;
											break;
										case "mute":
											self.mute = value;
											break;
										case "source":
											self.inputSource = value;
											break;
										case "bypass":
											self.tone = value;
											break;
										case "bass":
											self.bass = value;
											break;
										case "treble":
											self.treble = value;
											break;
										case "balance":
											self.balance = value;
											break;
										case "freq":
											self.freq = value;
											break;
									}
									self.stateChanged();
								}
							}
						}
					}
					this.dispatchEvent(new CustomEvent("responded", {bubbles: true}));
					console.log("event responded fired")
					buffer = "" // reset buffer-variable
				}
			}
		}
	}

	var discard = function() {
		webSocket.close();
	}
};

