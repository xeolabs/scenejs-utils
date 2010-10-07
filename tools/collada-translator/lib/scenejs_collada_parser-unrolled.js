/** @class Parses a COLLADA XML DOM into a JSON string that defines a SceneJS scene subgraph
 */
var SceneJS_ColladaToJSONParser = function() {  // Constructor

    /**
     * Parses the given XML document and returns the result through a callback. The result will contain
     * the JSON SceneJS subgraph, asset metadata and a manifest of Symbols within the subgraph.
     *
     * Result is like this:
     * <pre><code>
     * {
     *       body: {
     *
     *           // SceneJS subgraph parsed from the resource
     *
     *           rootNode: {
     *                 type: "node",
     *
     *                 nodes: [
     *
     *                      // ...
     *                 ]
     *          }
     *
     *           // Asset metadata
     *
     *           asset: {
     *               title: "Bridge",                   // Defaults to file name without extension
     *               description: "A cool bridge",      // Defaults to empty string
     *               contributor: "Lindsay Kay",        // Defaults to empty string
     *               tags: [ "architecture", "bridge" ] // Defaults to empty array
     *           },
     *
     *           // Manifest of resourse content
     *
     *           manifest: {
     *
     *              // Image files used as textures - useful if the client wants to
     *              // also fetch the images from the Web
     *
     *              attachments:[ "stoneTexture.jpg", "skyTexture.jpg" ]
     *       }
     *   }
     * </pre></code>
     * @param params
     * @param xmlDoc
     * @param callback
     */
    this.parse = function(params, xmlDoc, callback) {
        this._sources = {};
        this._nextSID = 0;
        this._uri = params.sourceURL || "";
        this._baseID = params.baseID;
        params.options = params.options || {};
        this._options = {
            comments : params.options.comments,
            boundingBoxes : params.options.boundingBoxes,
            info : params.options.info,
            imagesDir : params.options.imagesDir || this._uri.substring(0, this._uri.lastIndexOf("/") + 1)
        };
        this._xmlDoc = xmlDoc;

        /* Metadata on the resource, parsed from the <asset> tag
         */
        this._asset = {

        };

        /* Manifest of resource content
         */
        this._manifest = {
            symbols: {
                scenes : {},
                defaultSymbol : undefined
            },

            /* Images used in textures
             */
            attachments : []
        };
        this._buildIdMap();
        this._parseDocument(callback);
    };

    this._getInfo = function(str) {
        return (this._options.info) ? str : undefined;
    };

    /**
     * Finds every element in the xmlDoc and maps the by IDs into this._idMap
     */
    this._buildIdMap = function() {
        this._idMap = {};
        var elements = this._xmlDoc.getElementsByTagName("*");
        var id;
        for (var i = elements.length - 1; i >= 0; i--) {
            id = elements[i].getAttribute("id");
            if (id != "") {
                this._idMap[id] = elements[i];
            }
        }
    };

    this._randomSID = function() {
        return "sid" + this._nextSID++;
    };

    this._parseDocument = function(callback) {
        this._openNode({ type: "node" });
        this._addInfo("asset_root");
        if (this._uri) {
            this._addComment("Asset parsed from COLLADA resource at " + this._uri);
        }
        this._parseScene();
        this._closeNode();

        callback({
            body: {
                rootNode: this._getRoot(),
                asset : this._asset,
                manifest: this._manifest
            }
        });
    };


    this._parseScene = function() {
        var symbolID = "scene";
        var sceneTag = this._xmlDoc.getElementsByTagName("scene")[0];

        /* Root node of model
         */
        this._openNode({
            type: "node",
            id: this._makeID(symbolID)
        });
        var ivsTags = sceneTag.getElementsByTagName("instance_visual_scene");
        for (var i = 0; i < ivsTags.length; i++) {
            this._parseInstanceVisualScene(ivsTags[i]);
        }
        this._closeNode();
    };

    this._parseInstanceVisualScene = function(instanceVisualSceneTag) {
        var sid = instanceVisualSceneTag.getAttribute("sid") || this._randomSID();
        var target = instanceVisualSceneTag.getAttribute("url").substr(1); // Non-null for instance tags
        this._parseVisualScene(this._idMap[target]);
    };

    this._parseVisualScene = function(visualSceneTag) {
        var visualSceneID = visualSceneTag.getAttribute("id");
        var symbolID = this._makeID(visualSceneID);
        var childTag = visualSceneTag.firstChild;
        var graphs = [];
        do{
            if (childTag.tagName) {

                /* Explore each visual_scene node, then parse it if
                 * it does not contain lights or cameras. We're only
                 * interested in the actual model.
                 */
                if (this._isContentNode(childTag)) {
                    this._openNode({
                        type: "node",
                        id: symbolID
                    });
                    this._parseNode(childTag, visualSceneID);
                    this._closeNode();
                }
            }
        } while (childTag = childTag.nextSibling);
    };

    this._isContentNode = function(nodeTag) {
        var childTag = nodeTag.firstChild;
        do{
            switch (childTag.tagName) {
                case "node":
                    if (!this._isContentNode(childTag)) {
                        return false;
                    }
                    break;

                case "instance_camera":
                    return false;
                    break;

                case "instance_light":
                    return false;
                    break;
            }
        } while (childTag = childTag.nextSibling);
        return true;
    };

    this._parseNode = function(nodeTag) {
        var id = nodeTag.getAttribute("id");
        this._openNode({
            type: "node",
            id: this._makeID(id)
        });
        var xfStack = {
            stack : [],
            nProcessed: 0
        };
        var childTag = nodeTag.firstChild;
        do{
            if (childTag.tagName) {
                var childId = this._makeID(childTag.getAttribute("id"));
                var childSID = childTag.getAttribute("sid");

                switch (childTag.tagName) {
                    case "matrix":
                    case "translate":
                    case "rotate":
                    case "scale":
                    case "lookat":
                        xfStack.stack.push(childTag);
                        break;

                    case "node":
                        this._openXFStack(xfStack);
                        this._parseNode(childTag);
                        break;

                    case "instance_node":
                        this._openXFStack(xfStack);
                        var subNodeTag = this._idMap[childTag.getAttribute("url").substr(1)];
                        this._parseNode(subNodeTag);
                        break;

                    case "instance_visual_scene":
                        this._openXFStack(xfStack);
                        var visualSceneTag = childTag.getAttribute("url").substr(1);
                        this._parseVisualScene(visualSceneTag);
                        break;

                    case "instance_geometry":
                        this._openXFStack(xfStack);
                        this._parseInstanceGeometry(childTag);
                        break;
                }
            }
        } while (childTag = childTag.nextSibling);
        this._closeXFStack(xfStack);
        this._closeNode();
    };

    this._openXFStack = function(xfStack) {
        var tag;
        for (var i = xfStack.stack.length - 1; i >= xfStack.nProcessed; i--) {
            tag = xfStack.stack[i];
            switch (tag.tagName) {
                case "matrix":
                    this._openMatrix(tag);
                    break;
                case "translate":
                    this._openTranslate(tag);
                    break;
                case "rotate":
                    this._openRotate(tag);
                    break;
                case "scale":
                    this._openScale(tag);
                    break;
                case "lookat":
                    this._openLookat(tag);
                    break;
            }
        }
        xfStack.nProcessed = xfStack.stack.length;
    };

    this._closeXFStack = function(xfStack) {
        for (var i = 0; i < xfStack.nProcessed; i++) {
            this._closeNode();
        }
    };

    this._openRotate = function(rotateTag) {
        var array = this._parseFloatArray(rotateTag);
        this._openNode({
            type: "rotate",
            id: this._makeID(rotateTag.getAttribute("id")),
            sid: rotateTag.getAttribute("sid") || this._randomSID(),
            x: array[0],
            y: array[1],
            z: array[2],
            angle: array[3]
        });
        this._addInfo("rotate");
    };

    // @private
    this._openMatrix = function(matrixTag) {
        var array = this._parseFloatArray(matrixTag);
        this._openNode({
            type: "matrix",
            id: this._makeID(matrixTag.getAttribute("id")),
            sid: matrixTag.getAttribute("sid") || this._randomSID(),
            elements: [
                array[0],array[4],array[8],array[12],
                array[1],array[5],array[9],array[13],
                array[2],array[6],array[10],array[14],
                array[3],array[7],array[11],array[15]]
        });
        this._addInfo("matrix");
    };

    // @private
    this._openTranslate = function(translateTag) {
        var array = this._parseFloatArray(translateTag);
        this._openNode({
            type: "translate",
            id: this._makeID(translateTag.getAttribute("id")),
            sid: translateTag.getAttribute("sid") || this._randomSID(),
            x: array[0],
            y: array[1],
            z: array[2]
        });
        this._addInfo("translate");
    };

    // @private
    this._openScale = function(scaleTag) {
        var array = this._parseFloatArray(scaleTag);
        this._openNode({
            type: "scale",
            id: this._makeID(scaleTag.getAttribute("id")),
            sid: scaleTag.getAttribute("sid") || this._randomSID(),
            x: array[0],
            y: array[1],
            z: array[2]
        });
        this._addInfo("scale");
    };

    //==================================================================================================================
    // Geometry
    //==================================================================================================================

    this._parseInstanceGeometry = function(instanceGeometryTag) {

        /* COLLADA geometry elements like <triangles> can have a "material" attribute which identifies an
         * abstract material it is to be bound to when instantiated. The Geometry node created in the parseGeometry()
         * method is then wrapped in a Instance, which will dynamically receive via a WithConfig the URLs of a Symbols
         * that each wrap a Material.
         */
        var materialSymbols = {};
        var materials = instanceGeometryTag.getElementsByTagName("instance_material");
        var material;
        for (var i = 0; i < materials.length; i++) {
            material = materials[i];
            materialSymbols[material.getAttribute("symbol")] = material.getAttribute("target").substr(1);
        }
        var geometryTag = this._idMap[instanceGeometryTag.getAttribute("url").substr(1)];
        this._parseGeometry(geometryTag, materialSymbols);
    };

    this._parseGeometry = function(geometryTag, materialSymbols) {
        this._openNode({
            type: "node",
            id: this._makeID(geometryTag.getAttribute("id"))
        });
        var trianglesList = this._getTrianglesList(geometryTag);
        for (var it = 0; it < trianglesList.length; it++) {
            var triangle = trianglesList [it];
            var inputs = triangle.getElementsByTagName("input");
            var inputArray = [];
            var outputData = {};
            for (var n = 0; n < inputs.length; n++) {
				var group = inputs[n].getAttribute("semantic");
				var srcdata = [];
				if (group == "VERTEX") {
					srcdata[0] = this._getSource(inputs[n].getAttribute("source").substr(1),0);
					srcdata[1] = this._getSource(inputs[n].getAttribute("source").substr(1),1);
					inputs[n].data = srcdata;
					outputData["NORMAL"] = [];
				} else {
					inputs[n].data = this._getSource(inputs[n].getAttribute("source").substr(1),0);
				}
                if (group == "TEXCOORD") {
                    group = group + inputs[n].getAttribute("set") || 0;
                }
                inputs[n].group = group;
                inputArray[inputs[n].getAttribute("offset")] = inputs[n];
                outputData[group] = [];
            }
            var faces;
            if (triangle.getElementsByTagName("p")[0].data) {
                faces = triangle.getElementsByTagName("p")[0].data;
            }
            else {
                faces = this._parseFloatArray(triangle.getElementsByTagName("p")[0]);
            }
            for (var i = 0; i < faces.length; i = i + inputArray.length) {
                for (var n = 0; n < inputArray.length; n++) {
                    var group = inputArray[n].group;
                    var pCount = 0;
                    for (var j = 0; j < inputArray[n].data[0].stride; j++) {
                        if (inputArray[n].data[0].typeMask[j]) {
                            outputData[group].push(
                                    parseFloat(inputArray[n].data[0].array[faces[i + n]
                                            * inputArray[n].data[0].stride + j
                                            + inputArray[n].data[0].offset]));
							if (group == "VERTEX") {
							outputData["NORMAL"].push(
                                    parseFloat(inputArray[n].data[1].array[faces[i + n]
                                            * inputArray[n].data[1].stride + j
                                            + inputArray[n].data[1].offset]));
							}
                            pCount++;
                        }
                    }
                    if (group == "VERTEX" && pCount == 1) { // 1D
                        outputData[group].push(0);
                        outputData["NORMAL"].push(0);
                    }
                    if (group == "VERTEX" && pCount == 2) { // 2D
                        outputData[group].push(0);
                        outputData["NORMAL"].push(0);
                    }
                    if (group == "TEXCOORD0" && pCount == 3) { // 2D textures
                        outputData[group].pop();
                    }
                    if (group == "TEXCOORD1" && pCount == 3) {
                        outputData[group].pop();
                    }
                }
            }
            faces = [];
            for (n = 0; n < outputData.VERTEX.length / 3; n++) {
                faces.push(n);
            }

            /* BoundingBox
             */
            if (this._options.boundingBoxes) {
                var extents = this._expandExtentsByPositions(this._newExtents(), outputData.VERTEX);
                this._openNode({
                    type: "boundingBox",
                    boundary: extents
                });
            }

            function addGeometry() {  // ready to use in callback if required
                this._addNode({
                    type: "geometry",
                    positions: outputData.VERTEX,
                    normals: outputData.NORMAL,
                    uv : outputData.TEXCOORD0,
                    uv2 : outputData.TEXCOORD1,
                    indices: faces
                });
            }

            /* Material
             */
            var materialName = triangle.getAttribute("material");
            var materialTag;
            if (materialName) {
                var materialId = materialSymbols[materialName];
                materialTag = this._idMap[materialId];
                this._parseMaterial(materialTag, addGeometry);
            } else {
                addGeometry.call(this);
            }

            if (this._options.boundingBoxes) {
                this._closeNode(); // BoundingBox
            }
        }
        this._closeNode();
    };

    // @private
    this._getTrianglesList = function(geometryTag) {
        var trianglesList = [];
        var meshNode = geometryTag.getElementsByTagName("mesh")[0];
        var polyLists = meshNode.getElementsByTagName("polylist"); // Extract polylist children
        for (var i = 0; i < polyLists.length; i++) {
            var polyList = polyLists[i];
            polyList.getElementsByTagName("p")[0].data = this._getTrianglesFromPolyList(polyList);
            trianglesList.push(polyList);
        }
        var tris = meshNode.getElementsByTagName("triangles");
        for (i = 0; i < tris.length; i++) {
            trianglesList.push(tris[i]);
        }
        return trianglesList;
    };

    // @private
    this._getTrianglesFromPolyList = function(polyList) {
        var i, j, k;
        var inputs = polyList.getElementsByTagName("input");
        var maxOffset = this._getMaxOffset(inputs);
        var vcount = this._parseFloatArray(polyList.getElementsByTagName("vcount")[0]);
        var faces = this._parseFloatArray(polyList.getElementsByTagName("p")[0]);         // TODO: parseInt
        var triangles = [];
        var base = 0;
        for (i = 0; i < vcount.length; i++) {
            for (j = 0; j < vcount[i] - 2; j++) { // For each vertex
                for (k = 0; k <= maxOffset; k++) { // A
                    triangles.push(faces[base + k]);
                }
                for (k = 0; k <= maxOffset; k++) { // B
                    triangles.push(faces[base + (maxOffset + 1) * (j + 1) + k]);
                }
                for (k = 0; k <= maxOffset; k++) { // C
                    triangles.push(faces[base + (maxOffset + 1) * (j + 2) + k]);
                }
            }
            base = base + (maxOffset + 1) * vcount[i];
        }
        return triangles;
    };

    // @private
    this._getMaxOffset = function(inputs) {
        var maxOffset = 0;
        for (var n = 0; n < inputs.length; n++) {
            var offset = inputs[n].getAttribute("offset");
            if (offset > maxOffset) {
                maxOffset = offset;
            }
        }
        return maxOffset;
    };

    this._getSource = function(id,count) {
        if (count == 0) {
			var source = this._sources[id];
		} else {
			var source = this._sources[id+"N"];
		}
        if (source) {
            return source;
        }
        var element = this._idMap[id];

        var value;
        if (element.tagName == "vertices") {
			source = this._getSource(// Recurse to child <source> element
					element
							.getElementsByTagName("input")[count]
							.getAttribute("source")
							.substr(1),0);
        } else {
            var accessor = element.getElementsByTagName("technique_common")[0].getElementsByTagName("accessor")[0];
            var sourceArray = this._idMap[accessor.getAttribute("source").substr(1)];
            var type = sourceArray.tagName;
            value = this._parseFloatArray(sourceArray);
            var stride = parseInt(accessor.getAttribute("stride"));
            var offset = parseInt(accessor.getAttribute("offset"));
            if (!offset) offset = 0;
            if (!stride) stride = 1;
            var count = parseInt(accessor.getAttribute("count"));
            var params = accessor.getElementsByTagName("param");
            var pmask = [];
            for (var i = 0; i < params.length; i++) {
                if (params[i].hasAttribute("name")) {
                    pmask.push({type:params[i].getAttribute("type"),name:params[i].getAttribute("name")});
                } else {
                    pmask.push(false);
                }
            }
            source = {
                array:value,
                stride:stride,
                offset:offset,
                count:count,
                typeMask: pmask
            };
        }
		if (count == 1) {
			this._sources[id+"N"] = source;
		} else {
			this._sources[id] = source;
		}
        return source;
    };

    this._parseColor = function(node) {
        var arry = this._parseFloatArray(node);
        return { r: arry[0], g: arry[1], b: arry[2] };
    };

    // @private
    this._parseFloatArray = function(node) {
        var result = [];
        var prev = "";
        var child = node.firstChild;
        var currArray;
        while (child) {
            currArray = (prev + child.nodeValue).replace(/\s+/g, " ").replace(/^\s+/g, "").split(" ");
            child = child.nextSibling;
            if (currArray[0] == "") {
                currArray.unshift();
            }
            if (child) {
                prev = currArray.pop();
            }
            for (var i = 0; i < currArray.length; i++) {
                result.push(parseFloat(currArray[i]));
            }
        }
        return result;
    };

    this._newExtents = function() {
        const hugeNum = 9999999; // TODO: Guarantee this is max
        return {
            xmin : hugeNum, ymin : hugeNum, zmin : hugeNum,
            xmax : -hugeNum, ymax : -hugeNum, zmax : -hugeNum
        };
    };

    this._expandExtentsByPositions = function(e, positions) {
        for (var i = 0; i < positions.length - 2; i += 3) {
            var x = positions[i];
            var y = positions[i + 1];
            var z = positions[i + 2];
            if (x < e.xmin) e.xmin = x;
            if (y < e.ymin) e.ymin = y;
            if (z < e.zmin) e.zmin = z;
            if (x > e.xmax) e.xmax = x;
            if (y > e.ymax) e.ymax = y;
            if (z > e.zmax) e.zmax = z;
        }
        return e;
    };

    this._expandExtentsByExtents = function(e, e2) {
        if (e2.xmin < e.xmin) e.xmin = e2.xmin;
        if (e2.ymin < e.ymin) e.ymin = e2.ymin;
        if (e2.zmin < e.zmin) e.zmin = e2.zmin;
        if (e2.xmax > e.xmax) e.xmax = e2.xmax;
        if (e2.ymax > e.ymax) e.ymax = e2.ymax;
        if (e2.zmax > e.zmax) e.zmax = e2.zmax;
        return e;
    };

    //==================================================================================================================
    // Material
    //==================================================================================================================

    this._parseMaterial = function(materialTag, addGeometry) {
        var materialId = materialTag.getAttribute("id");
        var effectId = materialTag.getElementsByTagName("instance_effect")[0].getAttribute("url").substr(1);
        var effectTag = this._idMap[effectId];
        this._parseEffect(effectTag, addGeometry);
    };

    //==================================================================================================================
    // Effect
    //==================================================================================================================

    this._parseEffect = function(effectTag, addGeometry) {
        var profileCommonTag = effectTag.getElementsByTagName("profile_COMMON")[0];
        var techniqueTag = profileCommonTag.getElementsByTagName("technique")[0];
        var materialData = {
            texturesData : []
        };
        this._getDiffuseMaterialData(profileCommonTag, techniqueTag, materialData);
        this._getSpecularColorMaterialData(profileCommonTag, techniqueTag, materialData);
        this._getShininessMaterialData(profileCommonTag, techniqueTag, materialData);
        this._getBumpMapMaterialData(profileCommonTag, techniqueTag, materialData);

        var effectId = effectTag.getAttribute("id");

        this._openNode({ type: "material",
            id: this._makeID(effectId),
            baseColor:     materialData.baseColor,
            specularColor: materialData.specularColor ,
            shine:         10.0,  // TODO: parse from shininess?
            specular: 1
        });

        /* Add SceneJS.Texture child for textures data
         */
        var textureLayers = materialData.texturesData;
        if (textureLayers.length > 0) {
            var layers = [];
            for (var j = 0; j < textureLayers.length; j++) {
                layers.push({
                    uri : textureLayers[j].uri,
                    applyTo: textureLayers[j].applyTo,
                    flipY : false,
                    blendMode: textureLayers[j].blendMode,
                    wrapS: "repeat",
                    wrapT: "repeat" ,
                    minFilter: "linearMipMapLinear",
                    magFilter: "linear"
                });
            }
            this._openNode({
                type: "texture",
                sid: "texture",
                layers: layers
            });
            addGeometry.call(this);
            this._closeNode(); // texture
        } else {
            addGeometry.call(this);
        }
        this._closeNode(); // material
    };

    // @private
    this._getDiffuseMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var diffuseTag = techniqueTag.getElementsByTagName("diffuse");
        if (diffuseTag.length > 0) {
            var child = diffuseTag[0].firstChild;
            do{
                switch (child.tagName) {
                    case "color":
                        var color = child.firstChild.nodeValue.split(" ");
                        materialData.baseColor = { r:parseFloat(color[0]), g:parseFloat(color[1]), b:parseFloat(color[2]) };
                        break;

                    case "texture":
                        materialData.texturesData.push(
                                this._getTextureData(profileCommonTag, child, "baseColor"));
                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getSpecularColorMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var specular = techniqueTag.getElementsByTagName("specular");
        if (specular.length > 0) {
            var child = specular[0].firstChild;
            do{
                switch (child.tagName) {
                    case "color":
                        var color = child.firstChild.nodeValue.split(" ");
                        materialData.specularColor = { r:parseFloat(color[0]), g:parseFloat(color[1]), b:parseFloat(color[2]),a: 1 };
                        break;

                    case "texture":
                        materialData.texturesData.push(
                                this._getTextureData(profileCommonTag, child, "specularColor"));
                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getShininessMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var shininess = techniqueTag.getElementsByTagName("shininess");
        if (shininess.length > 0) {
            var child = shininess[0].firstChild;
            do{
                switch (child.tagName) {
                    case "float":
                        materialData.shine = parseFloat(child.firstChild.nodeValue);
                        break;

                    case "texture":
                        materialData.texturesData.push(
                                this._getTextureData(profileCommonTag, child, "shine"));

                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getBumpMapMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var bump = techniqueTag.getElementsByTagName("bump");
        if (bump.length > 0) {
            var child = bump[0].firstChild;
            do{
                switch (child.tagName) {
                    case "texture":
                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getTextureData = function(profileCommonTag, textureTag, applyTo) {
        var source = getSamplerSource(profileCommonTag, textureTag.getAttribute("texture"));
        var imageId = getImageId(profileCommonTag, source);
        var image = this._idMap[imageId];
        var imageFileName = image.getElementsByTagName("init_from")[0].firstChild.nodeValue;
        var blendMode = textureTag.getElementsByTagName("blend_mode")[0];               // TODO: should be nodeValue?
        this._manifest.attachments.push(imageFileName);
        return {
            uri : imageFileName,
            applyTo: applyTo,
            blendMode: (blendMode == "MULTIPLY") ? "multiply" : "add"
        };
    };

    // @private
    function getSamplerSource(profileTag, sid) {
        var params = profileTag.getElementsByTagName("newparam");
        for (var i = 0; i < params.length; i++) {
            if (params[i].getAttribute("sid") == sid) {
                return params[i]
                        .getElementsByTagName("sampler2D")[0]
                        .getElementsByTagName("source")[0]
                        .firstChild
                        .nodeValue;
            }
        }
        throw "COLLADA element expected: "
                + profileTag.tagName
                + "/newparam[sid == '"
                + sid + "']/sampler2D[0]/source[0]";
    }

    // @private
    function getImageId(profileTag, sid) {
        var newParamTags = profileTag.getElementsByTagName("newparam");
        for (var i = 0; i < newParamTags.length; i++) {
            if (newParamTags[i].getAttribute("sid") == sid) {
                var surfaceTag = newParamTags[i].getElementsByTagName("surface")[0];
                return surfaceTag
                        .getElementsByTagName("init_from")[0]
                        .firstChild
                        .nodeValue;
            }
        }
        throw "COLLADA element expected: "
                + profileTag.tagName
                + "/newparam[sid == '"
                + sid + "']/surface[0]/init_from[0]";
    }

    //==================================================================================================================
    // JSON builder funcs
    //==================================================================================================================

    this._root = null;
    this._stack = [];

    this._currentNode = {
        type: "node"
    };

    this._addNode = function(cfg) {
        this._openNode(cfg);
        this._closeNode();
    };

    this._openNode = function(node) {
        if (!this._root) {
            this._root = node;
        }
        if (this._currentNode) {
            if (!this._currentNode.nodes) {
                this._currentNode.nodes = [];
            }
            this._currentNode.nodes.push(node);
            this._stack.push(this._currentNode);
        }
        this._currentNode = node;
    };

    this._makeID = function(id) {
        return id ? this._baseID + "." + id : undefined;
    };

    this._makeTarget = function(target) {
        return target ? this._baseID + "." + target : undefined;
    };

    this._addComment = function(comment) {
        if (this._options.comments) {
            if (!this._currentNode.extra) {
                this._currentNode.extra = {};
            }
            this._currentNode.extra.comment = comment;
        }
    };

    this._addInfo = function(info) {
        if (this._options.info) {

            this._currentNode.info = info;
        }
    };

    this._closeNode = function() {
        this._currentNode = this._stack.pop();
    };

    this._getRoot = function() {
        while (this._currentNode) {
            this._closeNode();
        }
        return this._root || { type: "node" };
    };
};
