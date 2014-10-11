var net = require('net');

//连接两个buffer
function buffer_add(buf1, buf2){
	var buf1Len = buf1.length,
		res = new Buffer(buf1Len + buf2.length);
	buf1.copy(res);
	buf2.copy(res, buf1Len);
	return res;
}

//'\r\n\r\n'分开head和body
function buffer_find_body(data){
	var i = data.length;
	while(i-- && i>10){ //10都算少的了
		if(data[i]===0x0a&&data[i-2]===0x0a&&data[i-1]===0x0d&&data[i-3]===0x0d){
			return i+1;
		}
	}
	return -1;
}

//CONNECT {method:'CONNECT', host, port}
//GET/POST {metod, host, port, path, head, data}
function parse_header(data, pos, conf){
	var header_str = data.slice(0, pos).toString('utf8'); //console.log(header);
	var method = header_str.split(' ', 1)[0], arr;
	if(method==='CONNECT'){
		arr = header_str.match(/^[A-Z]+\s([^:\s]+):(\d+)\sHTTP/);
		if(arr){
			return {method:'CONNECT', host:arr[1], port:arr[2]};
		}
	}else{
		arr = header_str.match(/^[A-Z]+\s(\S+)\sHTTP\/(\d\.\d)/);
		if(arr){
			var host = header_str.match(/Host:\s([^\n\s\r]+)/)[1];
			if(host){
				var hp = host.split(':'),
					path = arr[1].replace(/^http:\/\/[^\/]+/, ''),
					r = header_str.indexOf('\r'),
					hd1 = header_str.slice(0, r),
					hd2 = header_str.slice(r);

				hd2 = hd2.replace(/Proxy-Connection:.+\r\n/ig, '')
					.replace(/Keep-Alive:.+\r\n/i, '')
					.replace('\r\n', '\r\nConnection: close\r\n');

				var header = {
					method: method,
					host: hp[0],
					port: hp[1] || '80',
					path: path,
					http_version: arr[2],
					data: data.slice(pos)
				};
				if(conf[hp[0]] && !hp[1]){ //只对80端口的请求检查是否代理到指定端口
					var routes = conf[hp[0]], i = 0, len = routes.length, match;
					for(; i < len; i++){
						match = path.match(routes[i].regexp);
						if(match){
							var h = routes[i].head(header, match);
							if(h.host){
								header.host = h.host;
								hd2 = hd2.replace('Host: '+host, 'Host: '+h.host+
									(h.port&&h.port!='80' ? ':'+h.port : ''));
							}
							h.port && (header.port = h.port);
							h.path && (header.path = h.path[0]==='/'?h.path:'/'+h.path);
							h.data && (header.data = h.data);
							break;
						}
					}
				}
				if(arr[2]==='1.1'){
					header.head = method+' '+header.path+' HTTP/1.1'+hd2;
				}else{
					header.head = method+' http://'+header.host+(header.port!='80'?':'+header.port:'')+
						header.path+' HTTP/'+arr[2]+hd2;
				}
				return header;
			}
		}
	}
	return false;
}

function relay_connection(header, client){ //console.log(header);
	var server = net.createConnection(header.port, header.host);
	server.on('data', function(data){
		client.write(data);
	});
	server.on('end', function(){
		//console.log('server close');
		client.end();
	});
	server.on('error', function(e){
		console.log('\nProxy Server ' + e +'\non request:');
		delete header.http_version, delete header.data;
		console.log(header);
		client.destroy();
	});

	client.on('data', function(data){
		server.write(data);
	});
	client.on('end', function(){
		//console.log('client close...');
		server.end();
	});
	client.on('error', function(){
		server.destroy();
	});

	if(header.method==='CONNECT'){
		client.write(new Buffer('HTTP/1.1 200 Connection established\r\n'+
			'Connection: close\r\n\r\n'));
	}else{
		server.write(new Buffer(header.head, 'utf8'));
		server.write(header.data); //data.slice(pos);
	}
}

function create_server(proxy_port, conf){
	var sockServer = net.createServer(function(client){
		var datas;
		client.on('data', function(data){
			if(datas){ //大部分请求都只触发一次data事件
				datas = buffer_add(datas, data);
			}else{
				datas = data;
			}
			var pos = buffer_find_body(datas);
			if(pos===-1)return;
			var header = parse_header(datas, pos, conf);
			if(header===false)return;
			client.removeAllListeners('data');
			relay_connection(header, client);
		});
	});

	sockServer.on('listening', function(){
		console.log('Proxy is listening '+sockServer.address().address+':'+proxy_port+' ...');
	});

	sockServer.listen(proxy_port);
}

exports.main = function(conf){
	for(var port in conf){
		if(conf.hasOwnProperty(port)){
			create_server(port, conf[port]||{});
		}
	}
};