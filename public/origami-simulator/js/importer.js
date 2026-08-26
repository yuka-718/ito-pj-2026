/**
 * Created by amandaghassaei on 5/6/17.
 */


function initImporter(globals){

    var reader = new FileReader();

    function importDemoFile(url){
        var extension = url.split(".");
        var name = extension[extension.length-2].split("/");
        name = name[name.length-1];
        extension = extension[extension.length-1];
        // globals.setCreasePercent(0);
        if (extension == "svg"){
            globals.url = url;
            globals.filename = name;
            globals.extension = extension;
            if (!globals.includeCurves) {
                globals.pattern.loadSVG("assets/" + url, true);
            } else {
                globals.curvedFolding.loadSVG("assets/" + url, true);
            }
        } else if (extension == "fold"){
                globals.url = url;
                globals.filename = name;
                globals.extension = extension;
                $.getJSON("assets/" + url, undefined, function (fold) {
                    globals.pattern.setFoldData(fold, true);
                });
        } else {
            console.warn("unknown extension: " + extension);
        }
    }

    // Adobe Illustrator and Cuttle.xyz copy vector shapes as SVG string. By
    // listening for a paste event, we can turn the SVG string into a Blob
    // to load it as the pattern. After this paste handler, it has the same code
    // path as selecting a local file.
    window.addEventListener('paste', function (e) {
        console.log("paste");
        // Make a synthetic svg file from text
        var text = e.clipboardData.getData('text/plain');
        if (text.includes("<svg")) {
            var blob = new Blob([text], {type: 'image/svg+xml'});

            globals.url = null;
            globals.filename = "paste";
            globals.extension = "svg";

            reader.onload = function () {

                $("#vertTol").val(globals.vertTol);
                $("#importSettingsModal").modal("show");
                $('#doSVGImport').unbind("click").click(function (e) {
                    e.preventDefault();
                    $('#doSVGImport').unbind("click");
                    if (!globals.includeCurves) {
                        globals.pattern.loadSVG(reader.result);    
                    } else {
                        globals.curvedFolding.loadSVG(reader.result);
                    }
                });
            }
            reader.readAsDataURL(blob);
        }
    });

    function openFile(file) {
        var extension = file.name.split(".");
        var name = extension[0];
        extension = extension[extension.length - 1];

        if (extension == "svg") {
            reader.onload = function () {
                return function (e) {
                    if (!reader.result) {
                        warnUnableToLoad();
                        return;
                    }
                    $("#vertTol").val(globals.vertTol);
                    $("#importSettingsModal").modal("show");
                    $('#doSVGImport').unbind("click").click(function (e) {
                        e.preventDefault();
                        $('#doSVGImport').unbind("click");
                        globals.filename = name;
                        globals.extension = extension;
                        globals.url = null;
                        if (!globals.includeCurves) {
                            globals.pattern.loadSVG(reader.result);    
                        } else {
                            globals.curvedFolding.loadSVG(reader.result);
                        }
                    });
                }
            }(file);
            reader.readAsDataURL(file);
        } else if (extension == "fold"){
            reader.onload = function () {
                return function (e) {
                    if (!reader.result) {
                        warnUnableToLoad();
                        return;
                    }
                    globals.filename = name;
                    globals.extension = extension;
                    globals.url = null;

                    try {
                        var fold = JSON.parse(reader.result);
                        if (!fold || !fold.vertices_coords || !fold.edges_assignment || !fold.edges_vertices || !fold.faces_vertices){
                            globals.warn("Invalid FOLD file, must contain all of: <br/>" +
                                "<br/>vertices_coords<br/>edges_vertices<br/>edges_assignment<br/>faces_vertices");
                            return;
                        }

                        // spec 1.0 backwards compatibility
                        if (fold.edges_foldAngles){
                            fold.edges_foldAngle = fold.edges_foldAngles;
                            delete fold.edges_foldAngles;
                        }
                        if (fold.edges_foldAngle){
                            globals.pattern.setFoldData(fold);
                            return;
                        }
                        $("#importFoldModal").modal("show");
                        $('#importFoldModal').on('hidden.bs.modal', function () {
                            $('#importFoldModal').off('hidden.bs.modal');
                            if (globals.foldUseAngles) {//todo this should all go to pattern.js
                                globals.setCreasePercent(1);
                                var foldAngles = [];
                                for (var i=0;i<fold.edges_assignment.length;i++){
                                    var assignment = fold.edges_assignment[i];
                                    if (assignment == "F") foldAngles.push(0);
                                    else foldAngles.push(null);
                                }
                                fold.edges_foldAngle = foldAngles;

                                var allCreaseParams = globals.pattern.setFoldData(fold, false, true);
                                var j = 0;
                                var faces = globals.pattern.getTriangulatedFaces();
                                for (var i=0;i<fold.edges_assignment.length;i++){
                                    var assignment = fold.edges_assignment[i];
                                    if (assignment !== "M" && assignment !== "V" && assignment !== "F") continue;
                                    var creaseParams = allCreaseParams[j];
                                    var face1 = faces[creaseParams[0]];
                                    var vec1 = makeVector(fold.vertices_coords[face1[1]]).sub(makeVector(fold.vertices_coords[face1[0]]));
                                    var vec2 = makeVector(fold.vertices_coords[face1[2]]).sub(makeVector(fold.vertices_coords[face1[0]]));
                                    var normal1 = (vec2.cross(vec1)).normalize();
                                    var face2 = faces[creaseParams[2]];
                                    vec1 = makeVector(fold.vertices_coords[face2[1]]).sub(makeVector(fold.vertices_coords[face2[0]]));
                                    vec2 = makeVector(fold.vertices_coords[face2[2]]).sub(makeVector(fold.vertices_coords[face2[0]]));
                                    var normal2 = (vec2.cross(vec1)).normalize();
                                    var angle = Math.abs(normal1.angleTo(normal2));
                                    if (assignment == "M") angle *= -1;
                                    fold.edges_foldAngle[i] = angle * 180 / Math.PI;
                                    creaseParams[5] = fold.edges_foldAngle[i];
                                    j++;
                                }
                                globals.model.buildModel(fold, allCreaseParams);
                                return;
                            }
                            var foldAngles = [];
                            for (var i=0;i<fold.edges_assignment.length;i++){
                                var assignment = fold.edges_assignment[i];
                                if (assignment == "M") foldAngles.push(-180);
                                else if (assignment == "V") foldAngles.push(180);
                                else if (assignment == "F") foldAngles.push(0);
                                else foldAngles.push(null);
                            }
                            fold.edges_foldAngle = foldAngles;
                            globals.pattern.setFoldData(fold);
                        });
                    } catch(err) {
                        globals.warn("Unable to parse FOLD json.");
                        console.log(err);
                    }
                }
            }(file);
            reader.readAsText(file);
        } else {
            globals.warn('Unknown file extension: .' + extension);
            return null;
        }
    }

    window.addEventListener('drop', function(e) {
        e.preventDefault();
        if (e.dataTransfer.items) {
            for (item of e.dataTransfer.items) {
                if (item.kind === "file") {
                    const file = item.getAsFile();
                    openFile(file)
                    break;
                }
            }
        } else {
            for (item of e.dataTransfer.files) {
                openFile(file)
                break;
            }
        }
    });

    window.addEventListener('dragover', function(e) {
        e.preventDefault();
    }, false);

    // ORIAI same-origin iframe bridge. The upstream bridge accepted messages
    // from any source and replied to "*"; this vendored embed is intentionally
    // narrower and only exposes FOLD import to its direct parent.
    var bridgeId = 'bridge-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    var activeBridgeRequest = null;
    var bridgeOrigin = window.location.origin;
    var maxBridgeVertices = 20000;
    var maxBridgeEdges = 40000;
    var maxBridgeFaces = 40000;

    function bridgeReply(status, requestId, detail) {
        if (!window.parent || window.parent === window || bridgeOrigin === 'null') return;
        var message = {
            from: 'OrigamiSimulator',
            bridgeVersion: 1,
            bridgeId: bridgeId,
            status: status
        };
        if (requestId) message.requestId = requestId;
        if (detail) message.detail = detail;
        window.parent.postMessage(message, bridgeOrigin);
    }

    function bridgeFailure(requestId, code, error) {
        var message = error && error.message ? error.message : String(error || code);
        bridgeReply('error', requestId, {
            code: code,
            message: message.slice(0, 240)
        });
    }

    function isFiniteBridgePoint(point) {
        return Array.isArray(point)
            && (point.length === 2 || point.length === 3)
            && point.every(function(value) { return Number.isFinite(value); });
    }

    function prepareBridgeFold(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('fold must be an object');
        }
        var vertices = value.vertices_coords;
        var edges = value.edges_vertices;
        var assignments = value.edges_assignment;
        var faces = value.faces_vertices;
        if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > maxBridgeVertices
            || !vertices.every(isFiniteBridgePoint)) {
            throw new Error('vertices_coords is invalid');
        }
        if (!Array.isArray(edges) || edges.length < 1 || edges.length > maxBridgeEdges
            || !edges.every(function(edge) {
                return Array.isArray(edge) && edge.length === 2
                    && edge.every(function(index) {
                        return Number.isInteger(index) && index >= 0 && index < vertices.length;
                    })
                    && edge[0] !== edge[1];
            })) {
            throw new Error('edges_vertices is invalid');
        }
        var allowedAssignments = {B: true, M: true, V: true, F: true, U: true, C: true, J: true};
        if (!Array.isArray(assignments) || assignments.length !== edges.length
            || !assignments.every(function(assignment) { return allowedAssignments[assignment] === true; })) {
            throw new Error('edges_assignment is invalid');
        }
        if (!Array.isArray(faces) || faces.length < 1 || faces.length > maxBridgeFaces
            || !faces.every(function(face) {
                return Array.isArray(face) && face.length >= 3
                    && face.every(function(index) {
                        return Number.isInteger(index) && index >= 0 && index < vertices.length;
                    });
            })) {
            throw new Error('faces_vertices is required for simulation');
        }

        var fold = JSON.parse(JSON.stringify(value));
        if (!Array.isArray(fold.edges_foldAngle) || fold.edges_foldAngle.length !== edges.length) {
            fold.edges_foldAngle = assignments.map(function(assignment) {
                if (assignment === 'M') return -180;
                if (assignment === 'V') return 180;
                if (assignment === 'F') return 0;
                return null;
            });
        } else {
            fold.edges_foldAngle = fold.edges_foldAngle.map(function(angle, index) {
                if (angle === null || Number.isFinite(angle)) return angle;
                if (assignments[index] === 'M') return -180;
                if (assignments[index] === 'V') return 180;
                if (assignments[index] === 'F') return 0;
                return null;
            });
        }
        return fold;
    }

    function waitForBridgeModel(requestId, expectedVertexCount, startedAt) {
        if (requestId !== activeBridgeRequest) return;
        try {
            var nodes = globals.model && globals.model.getNodes ? globals.model.getNodes() : [];
            var renderer = globals.threeView && globals.threeView.renderer;
            if (!globals.needsSync && !globals.simNeedsSync
                && nodes.length === expectedVertexCount
                && renderer && renderer.domElement) {
                window.requestAnimationFrame(function() {
                    window.requestAnimationFrame(function() {
                        if (requestId !== activeBridgeRequest) return;
                        bridgeReply('loaded', requestId, {
                            vertices: expectedVertexCount,
                            faces: globals.model.getFaces().length
                        });
                    });
                });
                return;
            }
        } catch (error) {
            bridgeFailure(requestId, 'solver_sync_failed', error);
            return;
        }
        if (Date.now() - startedAt > 12000) {
            bridgeFailure(requestId, 'solver_sync_timeout', new Error('solver did not become ready'));
            return;
        }
        window.setTimeout(function() {
            waitForBridgeModel(requestId, expectedVertexCount, startedAt);
        }, 50);
    }

    window.addEventListener('message', function(e) {
        if (window.parent === window || e.source !== window.parent || e.origin !== bridgeOrigin) return;
        var data = e.data;
        if (!data || typeof data !== 'object' || data.from !== 'ORIAI') return;
        if (data.op === 'hello') {
            bridgeReply('ready', null, {capabilities: ['importFold']});
            return;
        }
        if (data.op !== 'importFold' || typeof data.requestId !== 'string'
            || data.requestId.length < 1 || data.requestId.length > 120) return;

        activeBridgeRequest = data.requestId;
        try {
            var fold = prepareBridgeFold(data.fold);
            globals.filename = typeof fold.file_title === 'string' ? fold.file_title.slice(0, 120) : 'message';
            globals.extension = 'fold';
            globals.url = null;
            globals.foldUseAngles = true;
            globals.setCreasePercent(1);
            globals.creasePercent = 1;
            globals.shouldChangeCreasePercent = true;
            var processed = globals.pattern.setFoldData(fold);
            if (!processed || !Array.isArray(processed.vertices_coords)) {
                throw new Error('simulator rejected the FOLD document');
            }
            waitForBridgeModel(data.requestId, processed.vertices_coords.length, Date.now());
        } catch (error) {
            bridgeFailure(data.requestId, 'import_failed', error);
        }
    });

    // Defer the signal until main.js has finished constructing every module.
    window.setTimeout(function() {
        bridgeReply('ready', null, {capabilities: ['importFold']});
    }, 0);

    $("#fileSelector").change(function(e) {
        var files = e.target.files; // FileList object
        if (files.length < 1) {
            return;
        }
        openFile(files[0])
        $(e.target).val("");
    });

    function makeVector(v){
        if (v.length == 2) return makeVector2(v);
        return makeVector3(v);
    }
    function makeVector2(v){
        return new THREE.Vector2(v[0], v[1]);
    }
    function makeVector3(v){
        return new THREE.Vector3(v[0], v[1], v[2]);
    }

    function warnUnableToLoad(){
        globals.warn("Unable to load file.");
    }

    return {
        importDemoFile: importDemoFile
    }
}
