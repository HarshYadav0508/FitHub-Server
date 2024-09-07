const express = require('express');
const cors = require('cors');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_KEY);
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 5000;

console.log("DB user name:", process.env.DB_USER);

// Middleware
const corsOptions = {
    origin: 'https://fithub-tau-two.vercel.app', 
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], 
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
app.use(cors(corsOptions));
app.use(express.json());

//Verify token
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'Unauthorize access' })
    }
    const token = authorization?.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_KEY, (err, decoded) => {
        if (err) {
            return res.status(403).send({ error: true, message: 'forbidden user or token has expired' })
        }
        req.decoded = decoded;
        next()
    })
}


// Mongodb connection
const { MongoClient, ServerApiVersion, ObjectId, Transaction } = require('mongodb');
const uri = process.env.DB_URL;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();

    // Database and collections
    const database = client.db("fithub");
    const userCollection = database.collection("users");
    const classCollection = database.collection("classes");
    const cartCollection = database.collection("cart");
    const paymentCollection = database.collection("payments");
    const enrolledCollection = database.collection("enrolled");
    const appliedCollection = database.collection("applied");

    //Admin and instructor middleware
    const verifyAdmin = async (req, res, next) => {
        const email = req.decoded.email;
        const query = { email: email };
        const user = await userCollection.findOne(query);
        if (user.role === 'admin') {
            next()
        }
        else {
            return res.status(401).send({ error: true, message: 'Unauthorize access' })
        }
    }

    const verifyInstructor = async (req, res, next) => {
        const email = req.decoded.email;
        const query = { email: email };
        const user = await userCollection.findOne(query);
        if (user.role === 'instructor' || user.role === 'admin') {
            next()
        }
        else {
            return res.status(401).send({ error: true, message: 'Unauthorize access' })
        }
    }



    //USER Routes=================================================================================================================
    app.post('/new-user', async (req, res) => {
        try {
            const newUser = req.body;
            const result = await userCollection.insertOne(newUser);
            res.status(201).send(result);
        } catch (error) {
            console.error('Error inserting user:', error);
            res.status(500).send({ error: 'Failed to insert user' });
        }
    });

    
    app.post('/api/set-token', (req, res) => {
        const user = req.body;
        const token = jwt.sign(user, process.env.ACCESS_KEY, { expiresIn: '24h' })
        res.send({ token })
    })


    // GET ALL USERS
    app.get('/users', async (req, res) => {
        const users = await userCollection.find({}).toArray();
        res.send(users);
    })
    // GET USER BY ID
    app.get('/users/:id', async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const user = await userCollection.findOne(query);
        res.send(user);
    })
    // GET USER BY EMAIL
    app.get('/user/:email', verifyJWT, async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const result = await userCollection.findOne(query);
        res.send(result);
    })
    // Delete a user

    app.delete('/delete-user/:id', verifyJWT, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await userCollection.deleteOne(query);
        res.send(result);
    })
    // UPDATE USER
    app.put('/update-user/:id', verifyJWT, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const updatedUser = req.body;
        const filter = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const updateDoc = {
            $set: {
                name: updatedUser.name,
                role: updatedUser.option,
                phone: updatedUser.phone,
                about: updatedUser.about,
            }
        }
        const result = await userCollection.updateOne(filter, updateDoc, options);
        res.send(result);
    })

    //Update user Role
    app.patch('/update-user-role/:id', verifyJWT, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;  
    
        if (!role) {
            return res.status(400).send({ message: 'Role is required' });
        }
    
        try {
            
            const appliedUser = await appliedCollection.findOne({ _id: new ObjectId(id) });
    
            if (!appliedUser) {
                return res.status(404).send({ message: 'Applied user not found' });
            }
    
            
            const user = await userCollection.findOne({ email: appliedUser.email });
    
            if (!user) {
                return res.status(404).send({ message: 'User not found in userCollection' });
            }
    
            
            const updateDoc = { $set: { role: role } };
            const result = await userCollection.updateOne({ email: appliedUser.email }, updateDoc);
    
            if (result.modifiedCount === 0) {
                return res.status(404).send({ message: 'User role unchanged or not found' });
            }
    
            
            await appliedCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role: 'instructor' } } 
            );
    
            res.send({ message: 'User role updated successfully' });
        } catch (error) {
            res.status(500).send({ message: error.message });
        }
    });

    //DELETING APPLIED USER
    app.delete('/delete-applied-instructor/:id', verifyJWT, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
    
        try {
            const result = await appliedCollection.deleteOne(filter);
            if (result.deletedCount > 0) {
                res.send({ message: 'Applied instructor removed successfully' });
            } else {
                res.status(404).send({ message: 'Instructor not found' });
            }
        } catch (error) {
            res.status(500).send({ message: error.message });
        }
    });

    // Routes for CLASSES =======================================================================================================
    app.post('/new-class', verifyJWT, verifyInstructor, async (req, res) => {
      const newClass = req.body;
      //newClass.availableSeats = parseInt(newClass.availableSeats);
      const result = await classCollection.insertOne(newClass);
      res.send(result);
    });

    // GET ALL CLASSES ADDED BY INSTRUCTOR
    app.get('/classes/:email', verifyJWT, verifyInstructor, async (req, res) => {
        const email = req.params.email;
        const query = { instructorEmail: email };
        const result = await classCollection.find(query).toArray();
        res.send(result);
    });

    // getting approved classes
    app.get('/classes', async (req, res) => {
        const query = { status: "approved"};
        const result = await classCollection.find(query).toArray();
        res.send(result);
    })
    // getting a single class
    app.get('/class/:id', async(req,res) => {
        const id = req.params.id;
        const query = {_id: new ObjectId(id)};
        const result = await classCollection.findOne(query);
        res.send(result);
    })

    //get class by instructor name 
    app.get ('/classes/:name', async (req,res) => {
        const name = req.params.name;
        const query = {instructorName: name};
        const result = await classCollection.find(query).toArray();
        res.send(result);
    })

    //manage classes
    app.get('/classes-manage', async (req, res) => {
        const result = await classCollection.find().toArray();
        res.send(result);
    })

    //Admin ROUTES

    //Update class status and reason
    app.patch('/class-status/:id', verifyJWT, verifyAdmin, async (req,res) => {
        const id = req.params.id;
        const status = req.body.status;
        const reason = req.body.reason;
        const filter = { _id: new ObjectId(id)};
        const options = { upsert: true };
        const updateDoc = {
            $set: {
                status: status,
                reason: reason
            },
        };
        const result = await classCollection.updateOne(filter, updateDoc, options);
        res.send(result);
    })


    // update class info
    app.put('/update-class/:id', verifyJWT, verifyInstructor, async (req,res) => {
        const id = req.params.id;
        const updateClass = req.body;
        const filter = { _id: new ObjectId(id)};
        const options = { upsert: true };
        const updateDoc = {
            $set: {
                name: updateClass.name,
                availableSeats : updateClass.availableSeats,
                price: updateClass.price,
                videoLink: updateClass.videoLink,
                description: updateClass.description,
                instructorName: updateClass.instructorName,
                instructorEmail: updateClass.instructorEmail,
                status: updateClass.status
            },
        };
        const result = await classCollection.updateOne(filter, updateDoc, options);
        res.send(result);
    })

    //Routes for CART ===============================================================================================
    app.post('/add-to-cart', verifyJWT, async (req,res) => {
        const newCartItem = req.body;
        const result = await cartCollection.insertOne(newCartItem);
        res.send(result);
    })

    //get cart item through id
    app.get('/cart-item/:id', verifyJWT, async (req, res) => {
        const id = req.params.id;
        const email = req.query.email;
        const query = { classId: id, userMail: email };
        const projection = { classId: 1 };
        const result = await cartCollection.findOne(query, { projection: projection });
        res.send(result);
    })

    // cart by user id
    app.get('/cart/:email', verifyJWT, async (req, res) => {
        const email = req.params.email;
        const query = { userMail: email };
        const projection = { classId: 1 };
        const carts = await cartCollection.find(query, { projection: projection }).toArray();
        const classIds = carts.map(cart => new ObjectId(cart.classId));
        const query2 = { _id: { $in: classIds } };
        const result = await classCollection.find(query2).toArray();
        res.send(result);
    })

    //Deleting cart items
    app.delete('/delete-cart-item/:id', verifyJWT, async (req, res) => {
        const id = req.params.id;
        const query = { classId: id };
        const result = await cartCollection.deleteOne(query);
        res.send(result);
    })

    //PAYMENTS========================================================================================================================
    app.post('/create-payment-intent', verifyJWT, async (req,res) => {
        const { price } = req.body;
        const amount = parseInt(price)*100;
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",
            payment_method_types: ['card']
        })
        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    })

    //Payment info to DB
    app.post('/payment-info', verifyJWT, async (req, res) => {
        const paymentInfo = req.body;
        const classesId = paymentInfo.classesId;
        const userEmail = paymentInfo.userEmail;
        const singleClassId = req.query.classId;
        let query;
        // const query = { classId: { $in: classesId } };
        if (singleClassId) {
            query = { classId: singleClassId, userMail: userEmail };
        } else {
            query = { classId: { $in: classesId } };
        }
        const classesQuery = { _id: { $in: classesId.map(id => new ObjectId(id)) } }
        const classes = await classCollection.find(classesQuery).toArray();
        const newEnrolledData = {
            userEmail: userEmail,
            classesId: classesId.map(id => new ObjectId(id)),
            transactionId: paymentInfo.transactionId,
        }
        const updatedDoc = {
            $set: {
                totalEnrolled: classes.reduce((total, current) => total + current.totalEnrolled, 0) + 1 || 0,
                availableSeats: classes.reduce((total, current) => total + current.availableSeats, 0) - 1 || 0,
            }
        }
        // const updatedInstructor = await userCollection.find()
        const updatedResult = await classCollection.updateMany(classesQuery, updatedDoc, { upsert: true });
        const enrolledResult = await enrolledCollection.insertOne(newEnrolledData);
        const deletedResult = await cartCollection.deleteMany(query);
        const paymentResult = await paymentCollection.insertOne(paymentInfo);
        res.send({ paymentResult, deletedResult, enrolledResult, updatedResult });
    })


    //Payment History
    app.get('/payment-history/:email', async (req, res) => {
            const email = req.params.email;
            const query = { userEmail: email };
            const result = await paymentCollection.find(query).sort({ date: -1 }).toArray();
            res.send(result);
        })

    //History length
    app.get('/payment-history-length/:email', async (req, res) => {
        const email = req.params.email;
        const query = { userEmail: email };
        const total = await paymentCollection.countDocuments(query);
        res.send({ total });
    })

    //Routes for ENROLLMENTS=================================================================================================================

    //popular classes
    app.get('/popular-classes', async (req,res) => {
        const result = await classCollection.find().sort({totalEnrolled: -1}).limit(6).toArray();
        res.send(result);
    })

    //popular instructors
    app.get('/popular-instructors', async (req, res) => {
        const pipeline = [
            {
                $group: {
                    _id: "$instructorEmail",
                    totalEnrolled: { $sum: "$totalEnrolled" },
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "email",
                    as: "instructor"
                }
            },
            {
                $match: {
                    "instructor.role": "instructor"
                }
            },
            {
                $project: {
                    _id: 0,
                    instructor: {
                        $arrayElemAt: ["$instructor", 0]
                    },
                    totalEnrolled: 1
                }
            },
            {
                $sort: {
                    totalEnrolled: -1
                }
            },
            {
                $limit: 6
            }
        ]
        const result = await classCollection.aggregate(pipeline).toArray();
        res.send(result);

    })

    //get all intructors
    app.get('/instructors', async (req, res) => {
        const result = await userCollection.find({ role: 'instructor' }).toArray();
        res.send(result);
    })



    app.get('/enrolled-classes/:email', verifyJWT, async (req, res) => {
        const email = req.params.email;
        const query = { userEmail: email };
        const pipeline = [
            {
                $match: query
            },
            {
                $lookup: {
                    from: "classes",
                    localField: "classesId",
                    foreignField: "_id",
                    as: "classes"
                }
            },
            {
                $unwind: "$classes"
            },
            {
                $lookup: {
                    from: "users",
                    localField: "classes.instructorEmail",
                    foreignField: "email",
                    as: "instructor"
                }
            },
            {
                $project: {
                    _id: 0,
                    classes: 1,
                    instructor: {
                        $arrayElemAt: ["$instructor", 0]
                    }
                }
            }

        ]
        const result = await enrolledCollection.aggregate(pipeline).toArray();
        // const result = await enrolledCollection.find(query).toArray();
        res.send(result);
    })

    
    //Applied Routes================================================================================================================================'
    app.post('/as-instructor', async (req, res) => {
        const data = req.body;
        const result = await appliedCollection.insertOne(data);
        res.send(result);
    })
    
    app.get('/applied-instructors', async (req, res) => {
        try {
            const result = await appliedCollection.find({}).toArray();
            res.send(result);
        } catch (err) {
            res.status(500).send(err.message);
        }
    });


    app.get('/applied-instructors/:email',   async (req, res) => {
        const email = req.params.email;
        const result = await appliedCollection.findOne({email});
        res.send(result);
    });

    //ADMIN=================================================================================================================================
    app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
        // Get approved classes and pending classes and instructors 
        const approvedClasses = (await classCollection.find({ status: 'approved' }).toArray()).length;
        const pendingClasses = (await classCollection.find({ status: 'pending' }).toArray()).length;
        const instructors = (await userCollection.find({ role: 'instructor' }).toArray()).length;
        const totalClasses = (await classCollection.find().toArray()).length;
        const totalEnrolled = (await enrolledCollection.find().toArray()).length;
        // const totalRevenue = await paymentCollection.find().toArray();
        // const totalRevenueAmount = totalRevenue.reduce((total, current) => total + parseInt(current.price), 0);
        const result = {
            approvedClasses,
            pendingClasses,
            instructors,
            totalClasses,
            totalEnrolled,
            // totalRevenueAmount
        }
        res.send(result);
    })

    

    

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('FitHub!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
