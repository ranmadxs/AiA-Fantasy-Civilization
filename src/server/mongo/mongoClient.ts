import { MongoClient, Db, ServerApiVersion, Collection, Document, ObjectId } from "mongodb";
import { COLLECTIONS } from "./models";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const DB_NAME = process.env.MONGO_DB ?? "aia_civilization";

class MongoClientSingleton {
  private static instance: MongoClientSingleton;
  private client: MongoClient | null = null;
  private db: Db | null = null;

  private constructor() {}

  static getInstance(): MongoClientSingleton {
    if (!MongoClientSingleton.instance) {
      MongoClientSingleton.instance = new MongoClientSingleton();
    }
    return MongoClientSingleton.instance;
  }

  async connect(): Promise<Db> {
    if (this.db) return this.db;
    this.client = new MongoClient(MONGO_URI, {
      serverApi: ServerApiVersion.v1,
      maxPoolSize: 5,
      minPoolSize: 1,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    });
    await this.client.connect();
    this.db = this.client.db(DB_NAME);
    return this.db;
  }

  getDb(): Db {
    if (!this.db) throw new Error("MongoDB no conectado. Llama connect() primero.");
    return this.db;
  }

  getCollection<T extends Document>(name: keyof typeof COLLECTIONS): Collection<T> {
    return this.getDb().collection<T>(COLLECTIONS[name]);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}

export { MongoClientSingleton, COLLECTIONS, DB_NAME };
