console.clear();
console.time = console.time || function(){};
console.timeEnd = console.timeEnd || function(){};

(function(){

  "use strict";

  function each(obj,fn) {
    var length = obj.length,
        likeArray = ( length === 0 || ( length > 0 && (length - 1) in obj ) ),
        i = 0;

    if ( likeArray ) {
      for ( ; i < length; i++ ) { if ( fn.call( obj[ i ], i, obj[ i ] ) === false ) { break; } }
    } else {
      for (i in obj) { if ( fn.call( obj[ i ], i, obj[ i ] ) === false ) { break; } }
    }
  }

  // NOTE: this whole function is sent into a Web Worker via cw(), so it
  // must remain self-contained (no references to outer-scope variables).
  function convertImage(input){
    "use strict";

    var img = input.img,
        threshold = (typeof input.threshold === 'number') ? input.threshold : 128,
        axis = input.axis === 'vertical' ? 'vertical' : 'horizontal';

    function each(obj,fn) {
      var length = obj.length,
          likeArray = ( length === 0 || ( length > 0 && (length - 1) in obj ) ),
          i = 0;

      if ( likeArray ) {
        for ( ; i < length; i++ ) { if ( fn.call( obj[ i ], i, obj[ i ] ) === false ) { break; } }
      } else {
        for (i in obj) { if ( fn.call( obj[ i ], i, obj[ i ] ) === false ) { break; } }
      }
    }

    // Optimized for either horizontal or vertical runs
    function makePathData(x,y,length,axis) {
      return axis === 'vertical'
        ? ('M'+x+' '+y+'v'+length)
        : ('M'+x+' '+y+'h'+length);
    }
    function makePath(color,data) { return '<path stroke="'+color+'" d="'+data+'" />\n'; }

    // Sorts a COPY of `values` into run-adjacent order for the given axis,
    // then merges consecutive same-run pixels into [x,y,length] runs.
    // Returns the runs array (does not build path strings -- that's cheap
    // to do afterward once the winning axis is known).
    function buildRuns(values,axis){

      var sorted = values.slice(); // copy -- don't mutate the shared array

      if ( axis === 'vertical' ) {
        sorted.sort(function(a,b){ return a[0] - b[0] || a[1] - b[1]; }); // by x, then y
      } else {
        sorted.sort(function(a,b){ return a[1] - b[1] || a[0] - b[0]; }); // by y, then x
      }

      var runs = [];
      var curPath;
      var w = 1;

      each(sorted,function(){

        var continuesRun = false;

        if ( curPath ) {
          if ( axis === 'vertical' ) {
            continuesRun = ( this[0] === curPath[0] && this[1] === (curPath[1] + w) );
          } else {
            continuesRun = ( this[1] === curPath[1] && this[0] === (curPath[0] + w) );
          }
        }

        if ( continuesRun ) {
          w++;
        } else {
          if ( curPath ) {
            runs.push([curPath[0],curPath[1],w]);
            w = 1;
          }
          curPath = this;
        }

      });

      if ( curPath ) {
        runs.push([curPath[0],curPath[1],w]); // Finish last run
      }

      return runs;
    }

    function colorsToPaths(colors,axis){

      var output = "";

      // Loop through each bucket (black / white) to build paths
      each(colors,function(bucket,values){

        var color = bucket === 'black' ? '#000000' : '#ffffff';
        var chosenAxis, runs;

        if ( axis === 'auto' ) {
          // Decide per-bucket: whichever orientation produces fewer
          // distinct strokes wins for THIS shape (black or white),
          // independent of what the other bucket chooses.
          var horizRuns = buildRuns(values,'horizontal');
          var vertRuns = buildRuns(values,'vertical');

          if ( vertRuns.length < horizRuns.length ) {
            chosenAxis = 'vertical';
            runs = vertRuns;
          } else {
            chosenAxis = 'horizontal';
            runs = horizRuns;
          }
        } else {
          chosenAxis = axis;
          runs = buildRuns(values,axis);
        }

        var paths = [];
        each(runs,function(i,run){
          paths.push(makePathData(run[0],run[1],run[2],chosenAxis));
        });

        output += makePath(color,paths.join(''));
      });

      return output;
    }

    // Buckets every visible pixel as 'black' or 'white' based on a simple
    // RGB average compared against `threshold` (0-255). Alpha is ignored
    // for the black/white decision -- any pixel with alpha > 0 counts.
    var getColors = function(img,threshold) {
      var colors = {},
          data = img.data,
          len = data.length,
          w = img.width,
          x = 0,
          y = 0,
          i = 0,
          avg,
          bucket;

      for (; i < len; i+= 4) {
        if ( data[i+3] > 0 ) {
          avg = (data[i] + data[i+1] + data[i+2]) / 3;
          bucket = avg < threshold ? 'black' : 'white';
          colors[bucket] = colors[bucket] || [];
          x = (i / 4) % w;
          y = Math.floor((i / 4) / w);
          colors[bucket].push([x,y]);
        }
      }

      return colors;
    }

    var window = window || {};
    window.CP = {
      shouldStopExecution: function(){ return false; },
      exitedLoop: function(){}
    };

    var colors = getColors(img,threshold),
        paths = colorsToPaths(colors,axis),
        output = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -0.5 '+img.width+' '+img.height+'" shape-rendering="crispEdges">\n<metadata>Made with Pixels to Svg https://codepen.io/shshaw/pen/XbxvNj</metadata>\n' + paths + '</svg>';

    // Send message back to the main script
    return output;

  };


  // File Output
  var outputDiv = document.getElementById('output');

  function fileSize(str) {
    var bytes = encodeURI(str).split(/%..|./).length - 1;
    if ( bytes === 0 ) return 0;
    var sizes = ['bytes', 'kb', 'mb', 'gb', 'tb'],
        i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024))),
        size = bytes / Math.pow(1024, i);
    return (Math.round(size * 100) / 100) + ' ' + sizes[i];
  };

  function downloadLink(output,fileName,linkContent) {
    return '<a href="data:Application/octet-stream,'+ encodeURIComponent(output) +'" download="'+fileName+'.svg">' + (linkContent || output ) + '</a>';
  }

  function showOutput(output,fileName) {

    outputDiv.innerHTML = '<figure class="output">' + downloadLink(output,fileName) + '<figcaption class="output__details"><em class="output__size">Output size: ' + fileSize(output) + '</em>' + downloadLink(output,fileName,'<span class="download">Download SVG</span>') + '<pre contentEditable="true"  class="output__raw">' + output.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre></figcaption></figure>'  + outputDiv.innerHTML;

    console.timeEnd('conversion');
  }

  // Convert image to canvas ImageData
  function imageToData(img) {

    var canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d"),
        width = img.width,
        height = img.height;

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img,0,0);

    return ctx.getImageData(0,0,width,height);
  }

  // Reads current values from the threshold input and axis radios/select.
  // Falls back to sensible defaults if those controls aren't in the DOM yet,
  // so this won't break before you've added the HTML.
  function getThreshold() {
    var el = document.getElementById('threshold');
    var val = el ? parseInt(el.value, 10) : NaN;
    return isNaN(val) ? 128 : val;
  }

  function getAxis() {
    var el = document.querySelector('input[name="axis"]:checked') || document.getElementById('axis');
    var val = el ? el.value : 'horizontal';
    return ( val === 'vertical' || val === 'auto' ) ? val : 'horizontal';
  }

  var imageWorker = cw(convertImage);
  function convert(img,fileName){

    img = (img.type ? this : img ); // use `this` if `img` is event
    if ( !img || img === window ) { return false; }

    console.time('conversion');
    fileName = fileName || 'pixels';

    var imgData = imageToData(img);
    var threshold = getThreshold();
    var axis = getAxis();
    var payload = { img: imgData, threshold: threshold, axis: axis };

    if ( !Modernizr.webworkers || !Modernizr.blobworkers ) {
      console.log('No workers or blog support. Larger images may timeout.');
      var converted = convertImage(payload);
      showOutput(converted,fileName);
    } else {
      imageWorker.data(payload).then(function(converted){
        showOutput(converted,fileName);
      },function(e){
        outputDiv.innerHTML = outputRaw.innerHTML = "";
        console.error(e);
        console.timeEnd('conversion');
      });
    }
  }

  function makeImage(src,callback){
    var img = new Image();
    img.onload = callback;
    img.src = ( src.target ? src.target.result : src );
  }

  function loadFiles(e){
    var files = (e.target.files || e.dataTransfer.files || uploader.files),
        len = files.length,
        i = 0;

    each(files,function(i,file){
      var reader = new FileReader();
      var fileName = file.name;
      fileName = fileName.slice(0,fileName.lastIndexOf('.')) || fileName + "";
      reader.onload = function(e){
        console.log(e,arguments);
        makeImage(e,function(img){ convert(this,fileName); });
      }
      reader.readAsDataURL(files[i]);
    });

  }

  // File Uploader
  var uploader = document.getElementById('upload');
  uploader.onchange = loadFiles;

  // Test Image Conversion
  var test = document.getElementById('test');
  var testImage = document.getElementById('testImage');
  test.onclick = function(){ convert(testImage,'test'); }

  // Clear Output
  var clear = document.getElementById('clear');
  clear.onclick = function(){ output.innerHTML = ""; };

  // Drag & Drop
  var fileDrag = document.getElementById('filedrag');

  function FileDragReset(e){
    e.preventDefault();
    fileDrag.className = '';
  }

  function FileDragDrop(e){
    e = e || window.event;
    FileDragReset(e);
    loadFiles(e);
  }

  fileDrag.addEventListener("dragleave", FileDragReset);
  document.addEventListener("dragenter", function(){ fileDrag.className = 'dragenter'; });
  document.addEventListener('dragover',function(e){ e.preventDefault(); /* Essential! */ });
  document.addEventListener("drop", FileDragDrop);

}());