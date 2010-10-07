var SceneJS_WavefrontParser = function() {

    var node = null;
    var positions = [];
    var uv = [];
    var normals = [];
    var group = null;
    var index = 0;
    var indexMap = [];
    var mtllib;         // Name of auxiliary MTL file
    var groupNames = [];

    this.parse = function(params, url, cb) {

       // alert("SceneJS_WavefrontParser.prototype.parse url: " + url)

        this._openNode({ type : "node"});

        var self = this;

        this.loadFile(url, null,
                function(url, text) {

                    self.parseOBJ(text);

                    self._closeNode();

                    cb({
                        body: {
                            rootNode: self._getRoot(),
                            asset : {},
                            manifest: {}
                        }
                    });
                });
    };

    this.loadFile = function(url, relativeTo, callback) {
        var req = new XMLHttpRequest();
        var that = this;
        if (req) {
            req.overrideMimeType("text/plain")
            req.onreadystatechange = function() {
                if (this.readyState == 4)
                {
                    if (this.status == 200 || this.status == 0) {
                        that.loading = false;
                        callback.call(that, url, this.responseText);
                    } else {
                        throw "Error loading Document: " + url + " status " + this.status;
                    }
                }
            };
            req.open("GET", url, true);
            req.send("");
        }
    };


    this.parseOBJ = function(text) {
        this._openNode({ type: "node" });
        var lines = text.split("\n");
        var tokens;
        for (var i in lines) {
            var line = lines[i];
            if (line.length > 0) {
                line = lines[i].replace(/[ \t]+/g, " ").replace(/\s\s*$/, "");
                tokens = line.split(" ");
                if (tokens.length > 0) {

                    if (tokens[0] == "mtllib") { // Name of auxiliary MTL file
                        mtllib = tokens[1];
                    }
                    if (tokens[0] == "usemtl") { // Name of auxiliary MTL file
                        if (!group) {
                            this.openGroup(null, null); // Default group - no name or texture group
                        }
                        group.materialName = tokens[1];
                    }
                    if (tokens[0] == "v") { // vertex
                        positions.push(parseFloat(tokens[1]));
                        positions.push(parseFloat(tokens[2]));
                        positions.push(parseFloat(tokens[3]));
                    }
                    if (tokens[0] == "vt") {
                        uv.push(parseFloat(tokens[1]));
                        uv.push(parseFloat(tokens[2]));
                    }

                    if (tokens[0] == "vn") {
                        normals.push(parseFloat(tokens[1]));
                        normals.push(parseFloat(tokens[2]));
                        normals.push(parseFloat(tokens[3]));
                    }

                    if (tokens[0] == "g") {
                        this.closeGroup();
                        var name = tokens[1];
                        var textureGroup = tokens[2];
                        this.openGroup(name, textureGroup);
                    }

                    if (tokens[0] == "f") {
                        if (!group) {
                            this.openGroup("default", null); // Default group - default name, no texture group
                        }
                        this.parseFace(tokens);
                    }
                }
            }
        }
        this.closeGroup();
    };

    this.openGroup = function(name, textureGroup) {
        group = {
            name: name,
            textureGroup : textureGroup,
            positions: [],
            uv: [],
            normals: [],
            indices : [],
            materialName : null
        };
        //  indexMap = [];
        index = 0;
    };

    /**
     * Closes group if open; adds a subgraph with group ID containing a
     * Geometry node; if the group has a material, then the geometry
     * is wrapped in an Instance refering to the material library node.
     */
    this.closeGroup = function() {
        if (group) {
            this._openNode({ type: "node", id: group.name });
            if (group.materialName) {
                this._openNode({ type: "instance", id: group.materialName });
            }
            this._addNode({
                type: "geometry",
                primitive: "triangles",
                positions: group.positions,
                normals: group.normals,
                indices: group.indices,
                uv: group.uv
            });
            if (group.materialName) {
                this._closeNode();
            }
            this._closeNode();

            // Manifest

            groupNames.push(group.name);
        }
    };

    this.parseFace = function(tokens) {
        var vert = null;             // Array of refs to pos/tex/normal for a vertex
        var pos = 0;
        var tex = 0;
        var nor = 0;
        var x = 0.0;
        var y = 0.0;
        var z = 0.0;

        var indices = [];
        for (var i = 1; i < tokens.length; ++i) {
            if (!(tokens[i] in indexMap)) {
                vert = tokens[i].split("/");

                if (vert.length == 1) {
                    pos = parseInt(vert[0]) - 1;
                    tex = pos;
                    nor = pos;
                }
                else if (vert.length == 3) {
                    pos = parseInt(vert[0]) - 1;
                    tex = parseInt(vert[1]) - 1;
                    nor = parseInt(vert[2]) - 1;
                }
                else {
                    return;
                }

                x = 0.0;
                y = 0.0;
                z = 0.0;
                if ((pos * 3 + 2) < positions.length) {
                    x = positions[pos * 3];
                    y = positions[pos * 3 + 1];
                    z = positions[pos * 3 + 2];
                }
                group.positions.push(x);
                group.positions.push(y);
                group.positions.push(z);

                x = 0.0;
                y = 0.0;
                if ((tex * 2 + 1) < uv.length) {
                    x = uv[tex * 2];
                    y = uv[tex * 2 + 1];
                }
                group.uv.push(x);
                group.uv.push(y);

                x = 0.0;
                y = 0.0;
                z = 1.0;
                if ((nor * 3 + 2) < normals.length) {
                    x = normals[nor * 3];
                    y = normals[nor * 3 + 1];
                    z = normals[nor * 3 + 2];
                }
                group.normals.push(x);
                group.normals.push(y);
                group.normals.push(z);

                indexMap[tokens[i]] = index++;
            }
            indices.push(indexMap[tokens[i]]);
        }

        if (indices.length == 3) {

            /* Triangle
             */
            group.indices.push(indices[0]);
            group.indices.push(indices[1]);
            group.indices.push(indices[2]);

        } else if (indices.length == 4) {

            // TODO: Triangulate quads
        }
    };

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
        node = node || {};
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



