const express = require('express'); 
const cors = require('cors')
const erBase = require("eventregistry");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI('AIzaSyBcQpJYyhI3jn769sXjV_DTLp2Dcb20qro');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const app = express();
const port = 3000;
const cache = {};
const vercelkv = require('@vercel/kv');
const dotenv = require("dotenv");
const kv = vercelkv.kv;
const config = dotenv.config;
config();
app.use(express.text({ limit: '100mb', type:'text/plain' }));
app.use(express.json()); // For parsing JSON bodies
app.use(express.urlencoded({ extended: true }));
app.use(cors())
app.get('/news', async (req, res) => {
  try {   
    const response = await fetch('https://eventregistry.org/api/v1/article/getArticlesForTopicPage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uri: '1ffa7a20-c23f-434c-b785-12a05b4ebf06',
        infoArticleBodyLen: -1,
        resultType: 'articles',
        articlesSortBy: 'fq',
        apiKey: '3af292d9-b0b4-46a1-abb0-a00e01e517f5',
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const articles = data.articles.results;

    res.json({ articles });       
  } catch (error) {
    console.error('Error fetching news articles:', error);
    res.status(500).send('Internal Server Error');
  }
}); 
app.post('/upload', async (req, res) => {
    const uri = req.body;
    if (!uri) return res.status(400).send({ error: 'No URI provided' });
    try {
        const result = await model.generateContent([
            "I want you to send back a JSON object only, not even formatting. It must have a \"recyclable\" key, the value of which is a boolean that says whether the object in focus is recyclable or not. There should also be a \"type\" key, the value of which is a string, saying the following: \"This is a or these are [type of object in focus], which is/are\". Lastly, there should be an \"info\" key, the value of which is a string. This value should have any additional information or facts about its eco friendliness",
            {
                inlineData: {
                    data: uri.replace(/^data:image\/png;base64,/, ""),
                    mimeType: "image/png",
                },
            }
        ]);
        console.log(result.response.text());
        res.send(result.response.text());
    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).send('Internal Server Error');
    }
});
app.get('/article', async (req, res) => {
  const uri = req.query.uri;

  // Check if the article is in the cache
  if (cache[uri]) {
    return res.send(cache[uri]);
  }

  try {
    // Fetch article from the external API
    const response = await fetch('https://eventregistry.org/api/v1/article/getArticle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'getArticle',
        articleUri: uri,
        infoArticleBodyLen: -1,
        resultType: 'info',
        apiKey: '3af292d9-b0b4-46a1-abb0-a00e01e517f5',
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const articleData = data[uri].info;

    const newBody = await model.generateContent(
      `Format this using markdown, for the small sections you can add ## and ###\n${articleData.title}\n${articleData.date} by ${articleData.authors[0] ? articleData.authors[0].name : 'Anonymous'}\n ${articleData.body}`
    );

    // Cache the processed article content
    cache[uri] = newBody.response.candidates[0].content.parts[0].text;

    // Send the cached article content
    res.send(cache[uri]);

  } catch (error) {
    console.error('Error fetching news articles:', error);
    res.status(500).send('Internal Server Error');
  }
});
// Function to read from Vercel KV
const read = async (key) => await kv.get(key);

// Function to write to Vercel KV
const set = async (key, jsonData) => await kv.set(key, JSON.stringify(jsonData, null, 2));
// Function to update Vercel KV
const update = async (key, newData) => {
  const existingData = await read(key) || {};
  const updatedData = { ...existingData, ...newData };
  await set(key, updatedData);
};


// Utility function to get all posts
const getAllPosts = async () => {
  try {
    const posts = await read('posts');
    console.log(posts)
    return posts || [];
  } catch (error) {
    console.error('Error retrieving posts:', error);
    throw new Error('Internal Server Error');
  }
};

// Endpoint to post a new article or post
app.post('/posts', async (req, res) => {
  console.log(req.body)
  const { id, title, content, author, profilePicture } = req.body;

  if (!id || !title || !content || !author) {
    return res.status(400).send({ error: 'Missing required fields' });
  }

  try {
    let posts = await getAllPosts();
    const existingPost = posts.find(post => post.id === id);

    if (existingPost) {
      return res.status(400).send({ error: 'Post with this ID already exists' });
    }

    const postData = {
      id,
      title,
      content,
      author,
      profilePicture,
      likes: 0,
      comments: [],
    };
    posts.push(postData)
    set("posts",posts)
    res.status(201).send({ message: 'Post created successfully' });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Endpoint to like a post
app.post('/like', async (req, res) => {
  const { email, postId, newHasLiked } = req.body;

  if (!email || !postId) {
    return res.status(400).send({ error: 'Missing email or post ID' });
  }

  try {
    // Update the post's like count
    const posts = await getAllPosts();
    const postIndex = posts.findIndex(post => post.id === postId);

    if (postIndex === -1) {
      return res.status(404).send({ error: 'Post not found' });
    }

    posts[postIndex].likes += newHasLiked ? 1 : -1;
    await kv.set('posts', posts);

    // Update the user's liked posts
    let likedPosts = await kv.get(email) || [];
    if (newHasLiked) {
      if (!likedPosts.includes(postId)) {
        likedPosts.push(postId);
      }
    } else {
      likedPosts = likedPosts.filter(id => id !== postId);
    }
    await kv.set(email, likedPosts);

    res.send({ message: 'Post liked successfully' });
  } catch (error) {
    console.error('Error liking post:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Endpoint to get liked posts for a user
app.get('/likes/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const likedPosts = await kv.get(email) || [];
    res.status(200).send(likedPosts);
  } catch (error) {
    console.error('Error fetching liked posts:', error);
    res.status(500).send('Internal Server Error');
  }
});
// Endpoint to comment on a post
app.post('/comment', async (req, res) => {
  const { id, comment, author} = req.body;

  if (!id || !comment || !author) {
    return res.status(400).send({ error: 'Missing required fields' });
  }

  try {
    const posts = await getAllPosts();
    const postIndex = posts.findIndex(post => post.id === id);

    if (postIndex === -1) {
      return res.status(404).send({ error: 'Post not found' });
    }

    posts[postIndex].comments.push({comment:`${author}: ${comment}`});
    await set('posts', posts);
    res.send({ message: 'Comment added successfully' });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Endpoint to retrieve a post
app.get('/post/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const posts = await getAllPosts();
    const post = posts.find(post => post.id === id);

    if (!post) {
      return res.status(404).send({ error: 'Post not found' });
    }

    res.json(post);
  } catch (error) {
    console.error('Error retrieving post:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Endpoint to retrieve all posts
app.get('/posts', async (req, res) => {
  try {
    const posts = await getAllPosts(); // Utility function to get all posts
    res.json(posts);
  } catch (error) {
    console.error('Error retrieving posts:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});


